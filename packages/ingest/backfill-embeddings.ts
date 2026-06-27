/**
 * Generates embeddings for any document_chunks that have a NULL embedding.
 * Run after fix-fused-names.ts to make the newly split chunks searchable.
 *
 * Usage: npx tsx backfill-embeddings.ts
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

const openai = new OpenAI({
  apiKey: process.env.NAVIGATOR_API_KEY,
  baseURL: process.env.NAVIGATOR_BASE_URL,
});

const EMBEDDING_MODEL = 'nomic-embed-text-v1.5';
const BATCH = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function embed(texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

// Fetch all chunks missing embeddings
let from = 0;
const toFix: Array<{ id: string; content: string }> = [];

console.log('Loading chunks with missing embeddings…');
while (true) {
  const { data } = await supabase
    .from('document_chunks')
    .select('id, content')
    .is('embedding', null)
    .range(from, from + 999);
  if (!data || data.length === 0) break;
  toFix.push(...(data as typeof toFix));
  if (data.length < 1000) break;
  from += 1000;
}

console.log(`Found ${toFix.length} chunks to embed\n`);
if (toFix.length === 0) { console.log('Nothing to do.'); process.exit(0); }

let done = 0;
for (let i = 0; i < toFix.length; i += BATCH) {
  const batch = toFix.slice(i, i + BATCH);
  try {
    const embeddings = await embed(batch.map((c) => c.content));
    for (let j = 0; j < batch.length; j++) {
      await supabase
        .from('document_chunks')
        .update({ embedding: JSON.stringify(embeddings[j]) })
        .eq('id', batch[j].id);
    }
    done += batch.length;
    const pct = Math.round((done / toFix.length) * 100);
    process.stdout.write(`\r[${done}/${toFix.length}] ${pct}% complete`);
    await sleep(300);
  } catch (err) {
    console.error(`\nError on batch ${i}–${i + BATCH}:`, (err as Error).message);
    await sleep(2000);
  }
}

console.log('\n\n✅  All embeddings backfilled.');
