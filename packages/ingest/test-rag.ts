/**
 * Tests the full RAG pipeline locally to diagnose issues.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const openaiClient = new OpenAI({
  apiKey: process.env.NAVIGATOR_API_KEY!,
  baseURL: process.env.NAVIGATOR_BASE_URL,
});

const query = 'when did gokul muralidharan get tapped into fbk fall 2024';

console.log(`Query: "${query}"\n`);

// Step 1: Create embedding
console.log('1. Creating embedding...');
const embRes = await openaiClient.embeddings.create({
  model: 'nomic-embed-text-v1.5',
  input: query.replace(/\n/g, ' '),
});
const embedding = embRes.data[0].embedding;
console.log(`   Embedding dimensions: ${embedding.length}`);

// Step 2: Call match_document_chunks
console.log('\n2. Calling match_document_chunks...');
const { data, error } = await supabase.rpc('match_document_chunks', {
  query_embedding: embedding,
  match_count: 5,
  match_threshold: 0.0,
});

if (error) {
  console.log('   ERROR:', error);
} else {
  console.log(`   Got ${(data ?? []).length} chunks`);
  for (const chunk of (data ?? []) as any[]) {
    console.log(`   - sim=${chunk.similarity?.toFixed(3)} title="${chunk.metadata?.title}" content="${chunk.content?.slice(0,100)}"`);
  }
}

// Step 3: Also check total document_chunks count
const { count } = await supabase.from('document_chunks').select('*', { count: 'exact', head: true });
console.log(`\n3. Total document_chunks in DB: ${count}`);

// Check for tapping class chunks specifically
const { data: tappingChunks } = await supabase
  .from('document_chunks')
  .select('content, metadata')
  .ilike('content', '%gokul%')
  .limit(5);
console.log(`\n4. Chunks containing "gokul": ${tappingChunks?.length ?? 0}`);
for (const c of tappingChunks ?? []) {
  console.log(`   - title="${c.metadata?.title}" content="${c.content?.slice(0,200)}"`);
}
