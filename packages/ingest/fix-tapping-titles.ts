/**
 * Re-ingests the recent tapping class PDFs with correct year/semester titles.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

// Small chunks so each chunk covers only ~7 names, keeping individual name signal strong
const CHUNK_SIZE = 150;
const CHUNK_OVERLAP = 30;
const BATCH_SIZE = 5;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
const openaiClient = new OpenAI({
  apiKey: process.env.NAVIGATOR_API_KEY!,
  baseURL: process.env.NAVIGATOR_BASE_URL,
});

// Known mappings from check-pdfs output
const KNOWN: Array<{ fileId: string; title: string }> = [
  { fileId: '1Ldf5_-g6PiSaVY38XJEsusMCFq-UsZar', title: 'FBK Fall 2020 Tapping Class' },
  { fileId: '1PQMS7jZ619tZ2TANMEjk2KARXYXFdDsY', title: 'FBK Fall 2021 Tapping Class' },
  { fileId: '1OkHXrwOeIv_jFBnMSmBuhitzXnBr-yrA', title: 'FBK Fall 2023 Tapping Class' },
  { fileId: '1tmauIHdlFHFgFk_21ThSB3NcAhf_Ufki', title: 'FBK Spring 2021 Tapping Class' },
  { fileId: '19V_z3zcfVlB05FyMD8pkVAJr8PuhZZzX', title: 'FBK Fall 2022 Tapping Class' },
  { fileId: '1uFB_HUJYE0QD8ueuHz1zCaImeRZi2afw', title: 'FBK Spring 2022 Tapping Class' },
  { fileId: '1sqkfTD24X0LnOQCmRfI-dyAm3ygscgQi', title: 'FBK Spring 2023 Tapping Class' },
  { fileId: '10J3s8Hvp-RQZhjYs3yCQw-Bk4J0UnJU1', title: 'FBK Fall 2024 Tapping Class' },
  { fileId: '1iaTYCqwB2GUYf5-v--tJNIHbgGRCT8um', title: 'FBK Spring 2024 Tapping Class' },
  { fileId: '1o3DQDTh0MvIC32_YcuBE4vU_O1A28UBL', title: 'FBK Spring 2025 Tapping Class' },
];

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = start + CHUNK_SIZE;
    let chunk = normalized.slice(start, end);
    if (end < normalized.length) {
      const sentenceBreak = chunk.search(/[.!?\n]\s+\S[^.!?\n]{50,}$/);
      if (sentenceBreak > CHUNK_SIZE * 0.6) {
        chunk = chunk.slice(0, sentenceBreak + 1);
      } else {
        const wordBreak = chunk.lastIndexOf(' ');
        if (wordBreak > CHUNK_SIZE * 0.5) chunk = chunk.slice(0, wordBreak);
      }
    }
    const trimmed = chunk.trim();
    if (trimmed.length >= 40) chunks.push(trimmed);
    const advance = chunk.length - CHUNK_OVERLAP;
    start += advance > 0 ? advance : chunk.length;
  }
  return chunks;
}

async function embed(text: string): Promise<number[]> {
  const r = await openaiClient.embeddings.create({
    model: 'nomic-embed-text-v1.5',
    input: text.replace(/\n/g, ' '),
  });
  return r.data[0].embedding;
}

for (const { fileId, title } of KNOWN) {
  const sourceUrl = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
  console.log(`\n[${title}]`);

  try {
    const res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const parsed = await pdfParse(buf);
    const text = parsed.text;

    if (!text || text.trim().length < 20) {
      console.log('  ✗ No text extracted');
      continue;
    }

    // Upsert document
    const { data: existing } = await supabase.from('documents').select('id').eq('source_url', sourceUrl).maybeSingle();
    let docId: string;
    if (existing) {
      docId = existing.id;
      await supabase.from('documents').update({ title, status: 'pending' }).eq('id', docId);
      await supabase.from('document_chunks').delete().eq('document_id', docId);
    } else {
      const { data: newDoc, error } = await supabase.from('documents')
        .insert({ title, source_url: sourceUrl, mime_type: 'application/pdf', status: 'pending' })
        .select('id').single();
      if (error || !newDoc) { console.log('  ✗ DB error:', error?.message); continue; }
      docId = newDoc.id;
    }

    await supabase.from('documents').update({ status: 'ingesting' }).eq('id', docId);
    const chunks = chunkText(text);

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const rows = await Promise.all(batch.map(async (content, j) => ({
        id: uuidv4(),
        document_id: docId,
        content,
        metadata: { title, source_url: sourceUrl, chunk_index: i + j },
        embedding: await embed(`${title}: ${content}`),
      })));
      await supabase.from('document_chunks').insert(rows);
    }

    await supabase.from('documents')
      .update({ status: 'ingested', ingested_at: new Date().toISOString() })
      .eq('id', docId);

    console.log(`  ✓ ${chunks.length} chunks, ${text.length} chars`);
  } catch (e) {
    console.log(`  ✗ ${(e as Error).message.slice(0, 80)}`);
  }
}

console.log('\nAll done!');
