#!/usr/bin/env tsx
/**
 * FBK Chatbot – CLI ingestion script
 *
 * Usage:
 *   npx tsx packages/ingest/ingest.ts \
 *     --file ./docs/membership-guide.pdf \
 *     --title "Membership Guide" \
 *     --url "https://fbk.org/membership"
 *
 * Options:
 *   --file   <path>   Path to the file (PDF, TXT, or MD)
 *   --title  <text>   Human-readable title for the document
 *   --url    <url>    Source URL for citations (optional)
 *
 * Requires .env (or environment variables):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_KEY = process.env.OPENAI_API_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error('❌  Missing required environment variables. Check your .env file.');
  console.error('   Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const openai = new OpenAI({ apiKey: OPENAI_KEY });

const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;
const EMBED_BATCH_SIZE = 20;

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(): { file: string; title: string; url: string | null } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const file = get('--file');
  const title = get('--title');
  const url = get('--url') ?? null;

  if (!file || !title) {
    console.error('Usage: tsx ingest.ts --file <path> --title "<title>" [--url <url>]');
    process.exit(1);
  }

  return { file, title, url };
}

// ─── Text extraction ──────────────────────────────────────────────────────────

async function extractText(filePath: string, mimeType: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);

  if (mimeType === 'application/pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.text;
  }

  return buffer.toString('utf-8');
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.md') return 'text/markdown';
  return 'text/plain';
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  let start = 0;
  while (start < normalized.length) {
    const end = start + CHUNK_SIZE;
    let chunk = normalized.slice(start, end);

    // Try to break on a sentence boundary
    if (end < normalized.length) {
      const breakAt = chunk.search(/[.!?\n]\s+\S[^.!?\n]{50,}$/);
      if (breakAt > CHUNK_SIZE * 0.6) {
        chunk = chunk.slice(0, breakAt + 1);
      }
    }

    const trimmed = chunk.trim();
    if (trimmed.length >= 40) chunks.push(trimmed);
    start += chunk.length - CHUNK_OVERLAP;
  }

  return chunks;
}

// ─── Embedding ────────────────────────────────────────────────────────────────

async function embedChunks(chunks: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((c) => c.replace(/\n/g, ' ')),
    });
    embeddings.push(...response.data.map((d) => d.embedding));

    const done = Math.min(i + EMBED_BATCH_SIZE, chunks.length);
    process.stdout.write(`\r  Embedding chunks: ${done}/${chunks.length}`);
  }

  console.log(); // newline after progress
  return embeddings;
}

// ─── Upsert to Supabase ───────────────────────────────────────────────────────

async function upsertChunks(params: {
  documentId: string;
  title: string;
  sourceUrl: string | null;
  chunks: string[];
  embeddings: number[][];
}): Promise<void> {
  const { documentId, title, sourceUrl, chunks, embeddings } = params;

  // Delete old chunks (support re-ingestion)
  const { error: delError } = await supabase
    .from('document_chunks')
    .delete()
    .eq('document_id', documentId);

  if (delError) throw new Error(`Delete failed: ${delError.message}`);

  const rows = chunks.map((content, i) => ({
    document_id: documentId,
    content,
    metadata: { title, source_url: sourceUrl, chunk_index: i },
    embedding: JSON.stringify(embeddings[i]),
  }));

  // Insert in batches to avoid payload limits
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await supabase.from('document_chunks').insert(batch);
    if (error) throw new Error(`Insert failed: ${error.message}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { file, title, url } = parseArgs();

  const absPath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(absPath)) {
    console.error(`❌  File not found: ${absPath}`);
    process.exit(1);
  }

  const mimeType = mimeFromPath(absPath);
  console.log(`\n📄  File:     ${absPath}`);
  console.log(`📝  Title:    ${title}`);
  console.log(`🔗  URL:      ${url ?? '(none)'}`);
  console.log(`📋  MIME:     ${mimeType}`);
  console.log('');

  // 1. Insert document record (or reuse existing by title)
  let documentId: string;

  const { data: existing } = await supabase
    .from('documents')
    .select('id')
    .eq('title', title)
    .maybeSingle();

  if (existing) {
    documentId = existing.id;
    console.log(`♻️   Reusing existing document record: ${documentId}`);
    await supabase
      .from('documents')
      .update({ status: 'ingesting', source_url: url, mime_type: mimeType })
      .eq('id', documentId);
  } else {
    documentId = uuidv4();
    const { error: insertError } = await supabase.from('documents').insert({
      id: documentId,
      title,
      source_url: url,
      mime_type: mimeType,
      status: 'ingesting',
    });
    if (insertError) throw new Error(`Document insert failed: ${insertError.message}`);
    console.log(`➕  Created document record: ${documentId}`);
  }

  // 2. Extract text
  console.log('🔍  Extracting text…');
  const text = await extractText(absPath, mimeType);
  console.log(`    Extracted ${text.length.toLocaleString()} characters`);

  // 3. Chunk
  const chunks = chunkText(text);
  console.log(`✂️   Split into ${chunks.length} chunks`);

  // 4. Embed
  console.log('🧠  Creating embeddings…');
  const embeddings = await embedChunks(chunks);

  // 5. Upsert
  console.log('💾  Upserting to Supabase…');
  await upsertChunks({ documentId, title, sourceUrl: url, chunks, embeddings });

  // 6. Mark ingested
  await supabase
    .from('documents')
    .update({ status: 'ingested', ingested_at: new Date().toISOString() })
    .eq('id', documentId);

  console.log(`\n✅  Done! Ingested ${chunks.length} chunks for "${title}"\n`);
}

main().catch((err) => {
  console.error('\n❌  Ingestion failed:', err.message ?? err);
  // Try to mark the document as errored
  process.exit(1);
});
