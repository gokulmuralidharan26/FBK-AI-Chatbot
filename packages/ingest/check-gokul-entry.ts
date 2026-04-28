import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const openaiClient = new OpenAI({ apiKey: process.env.NAVIGATOR_API_KEY!, baseURL: process.env.NAVIGATOR_BASE_URL });

// Check Gokul entry
const { data: gokulChunks } = await supa
  .from('document_chunks')
  .select('id, content')
  .ilike('content', '%Gokul%');

console.log(`Chunks with Gokul: ${gokulChunks?.length}`);
for (const c of gokulChunks || []) {
  console.log(`  "${c.content.slice(0, 120)}"`);
}

// Check rank for this specific query
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
const r = await openaiClient.embeddings.create({ model: 'nomic-embed-text-v1.5', input: query });
const qEmb = r.data[0].embedding;

const { data: allChunks } = await supa.from('document_chunks').select('id, content, metadata, embedding').limit(700);
console.log(`\nTotal chunks: ${allChunks?.length}`);

const scored = (allChunks || []).map(chunk => {
  const raw = chunk.embedding;
  const emb: number[] = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return { chunk, sim: cosineSim(qEmb, emb) };
}).sort((a,b) => b.sim - a.sim);

const gokulRank = scored.findIndex(s => s.chunk.content.includes('Gokul Muralidharan'));
console.log(`Gokul entry rank: ${gokulRank + 1} (sim=${scored[gokulRank]?.sim.toFixed(4)})`);
console.log(`Gokul entry: "${scored[gokulRank]?.chunk.content.slice(0,100)}"`);

// Show top 10
console.log(`\nTop 10:`);
for (let i = 0; i < 10; i++) {
  const { chunk, sim } = scored[i];
  const gokul = chunk.content.includes('Gokul') ? ' *** GOKUL ***' : '';
  console.log(`  ${i+1}. ${sim.toFixed(4)} [${chunk.metadata?.title}] ${chunk.content.slice(0,60).replace(/\n/g,' ')}${gokul}`);
}
