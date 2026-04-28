import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const openaiClient = new OpenAI({ apiKey: process.env.NAVIGATOR_API_KEY!, baseURL: process.env.NAVIGATOR_BASE_URL });

// 1. Check chunks with short/garbage content  
const { data: shortChunks } = await supa.from('document_chunks').select('id,content,document_id').lte('content', '5');
console.log('Chunks with very short content (<=5 chars):', shortChunks?.length);
shortChunks?.slice(0,5).forEach(c => console.log(`  [${c.document_id.slice(0,8)}] "${c.content}"`));

// 2. Count chunks per document
const { data: allChunks } = await supa.from('document_chunks').select('document_id').limit(500);
const byDoc: Record<string, number> = {};
for (const c of allChunks || []) {
  byDoc[c.document_id] = (byDoc[c.document_id] || 0) + 1;
}

// Join with document titles
const docIds = Object.keys(byDoc);
const { data: docs } = await supa.from('documents').select('id,title').in('id', docIds);
const titleById: Record<string, string> = {};
for (const d of docs || []) titleById[d.id] = d.title;

console.log('\nChunks per document:');
Object.entries(byDoc).sort(([,a],[,b]) => b-a).forEach(([id,count]) => {
  const title = titleById[id] || id.slice(0,8);
  console.log(`  ${count} chunks: ${title}`);
});

// 3. Try the direct similarity for the Gokul chunk
const gokulQuery = 'gokul muralidharan fall 2024 tapping class';
const r = await openaiClient.embeddings.create({ model: 'nomic-embed-text-v1.5', input: gokulQuery });
const queryEmb = r.data[0].embedding;

// Get the Gokul chunk's embedding directly
const { data: gokulChunk } = await supa.from('document_chunks').select('id,content,embedding').ilike('content', '%Gokul%').single();
if (gokulChunk?.embedding) {
  // Parse the embedding string
  const stored = typeof gokulChunk.embedding === 'string' 
    ? JSON.parse(gokulChunk.embedding) 
    : gokulChunk.embedding as number[];
  // Compute cosine similarity manually
  let dot = 0, mag1 = 0, mag2 = 0;
  for (let i = 0; i < stored.length; i++) {
    dot += queryEmb[i] * stored[i];
    mag1 += queryEmb[i] ** 2;
    mag2 += stored[i] ** 2;
  }
  const sim = dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
  console.log(`\nDirect cosine sim for Gokul chunk vs query: ${sim.toFixed(4)}`);
  console.log(`Gokul chunk (${stored.length} dims): ${gokulChunk.content.slice(0,60).replace(/\n/g,' ')}`);
}
