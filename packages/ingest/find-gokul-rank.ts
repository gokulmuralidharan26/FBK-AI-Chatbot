import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const openaiClient = new OpenAI({ apiKey: process.env.NAVIGATOR_API_KEY!, baseURL: process.env.NAVIGATOR_BASE_URL });

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * (b[i] ?? 0);
    magA += a[i] ** 2;
    magB += (b[i] ?? 0) ** 2;
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

const query = 'when did gokul muralidharan get tapped into fbk';
console.log(`Query: "${query}"`);

const r = await openaiClient.embeddings.create({ model: 'nomic-embed-text-v1.5', input: query });
const qEmb = r.data[0].embedding;

const { data: allChunks } = await supa.from('document_chunks').select('id, content, metadata, embedding').limit(300);

const scored = (allChunks || []).map(chunk => {
  const raw = chunk.embedding;
  const emb: number[] = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return { chunk, sim: cosineSim(qEmb, emb) };
}).sort((a,b) => b.sim - a.sim);

// Show top 20 and find where Gokul chunk is
console.log(`Top 20 (of ${scored.length}):`);
for (let i = 0; i < 20; i++) {
  const { chunk, sim } = scored[i];
  const gokul = chunk.content.includes('Gokul') ? ' *** GOKUL ***' : '';
  console.log(`  ${i+1}. ${sim.toFixed(4)} [${chunk.metadata?.title}] ${chunk.content.slice(0,50).replace(/\n/g,' ')}${gokul}`);
}

const gokulRank = scored.findIndex(s => s.chunk.content.includes('Gokul'));
console.log(`\nGokul chunk rank: ${gokulRank + 1} (sim=${scored[gokulRank]?.sim.toFixed(4)})`);
