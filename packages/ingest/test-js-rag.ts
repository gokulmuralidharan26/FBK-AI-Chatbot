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

const queries = [
  'when did gokul muralidharan get tapped into fbk',
  'who was in the fall 2024 tapping class',
  'what is florida blue key',
];

for (const query of queries) {
  console.log(`\nQuery: "${query}"`);
  const r = await openaiClient.embeddings.create({ model: 'nomic-embed-text-v1.5', input: query });
  const qEmb = r.data[0].embedding;
  
  const { data: allChunks } = await supa.from('document_chunks').select('id, content, metadata, embedding').limit(300);
  
  const scored = (allChunks || []).map(chunk => {
    const raw = chunk.embedding;
    const emb: number[] = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { chunk, sim: cosineSim(qEmb, emb) };
  }).filter(s => s.sim > 0.3).sort((a,b) => b.sim - a.sim).slice(0, 5);
  
  console.log(`Top 5:`);
  for (const { chunk, sim } of scored) {
    const gokul = chunk.content.includes('Gokul') ? ' *** GOKUL ***' : '';
    console.log(`  ${sim.toFixed(4)} [${chunk.metadata?.title}] ${chunk.content.slice(0,50).replace(/\n/g,' ')}${gokul}`);
  }
}
