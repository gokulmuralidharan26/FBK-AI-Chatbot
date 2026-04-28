import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Check the Gokul chunk's embedding
const { data: gokulChunk } = await supa
  .from('document_chunks')
  .select('id, content, embedding')
  .ilike('content', '%Gokul%')
  .limit(1)
  .single();

if (!gokulChunk) {
  console.log('No Gokul chunk found');
  process.exit(1);
}

const emb = gokulChunk.embedding as number[] | null;
console.log('Gokul chunk ID:', gokulChunk.id);
console.log('Content:', gokulChunk.content.replace(/\n/g,' ').slice(0, 100));
if (!emb) {
  console.log('Embedding: NULL!');
} else if (Array.isArray(emb)) {
  console.log(`Embedding: ${emb.length} dims, first 3: ${emb.slice(0,3)}`);
} else {
  console.log('Embedding type:', typeof emb, JSON.stringify(emb).slice(0,50));
}

// Also check what the embedding column type is
const { data: sampleChunks } = await supa
  .from('document_chunks')
  .select('id, content')
  .limit(5);
console.log(`\nTotal sample chunks: ${sampleChunks?.length}`);
for (const c of sampleChunks || []) {
  console.log(`  ${c.id.slice(0,8)}: ${c.content.slice(0,40).replace(/\n/g,' ')}`);
}
