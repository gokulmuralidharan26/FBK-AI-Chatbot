/**
 * Ingests older tapping class files that are stored as PNG/JPG images (2008–2019)
 * using OCR via tesseract.js, plus any new PDF classes discovered during scraping.
 *
 * Run with: npx tsx ingest-image-tapping.ts
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { chromium } from 'playwright';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
// @ts-ignore – tesseract.js has no bundled types
import { createWorker } from 'tesseract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

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

// ── File catalog ─────────────────────────────────────────────────────────────
// type: 'image' = PNG/JPG (needs OCR), 'pdf' = PDF (needs pdf-parse)
const CATALOG: Array<{ fileId: string; title: string; type: 'image' | 'pdf' }> = [
  // ── Image files (OCR) ──────────────────────────────────────────────────────
  { fileId: '17js-qTPwr1G5JDvQUv03lqTr7fE9WVqa', title: 'FBK Fall 2008 Tapping Class',   type: 'image' },
  { fileId: '1G9DE4xfJs40os0Klfeaj2RUDVvI7GxoO', title: 'FBK Spring 2008 Tapping Class', type: 'image' },
  { fileId: '1r3blmuPWgopK1ZRU1wjtI-Qmdq9AWOwx', title: 'FBK Fall 2009 Tapping Class',   type: 'image' },
  { fileId: '10aoAyS66AXUmagzWUbYDf-JpuVog_rSH', title: 'FBK Spring 2009 Tapping Class', type: 'image' },
  { fileId: '1CeavD0NzWxEZq4nEUaQHwE3XG0MJwQ3J', title: 'FBK Fall 2010 Tapping Class',   type: 'image' },
  { fileId: '1lGvRHCBU7E5irvHsrevQ_GEbS5pK4Afk', title: 'FBK Spring 2010 Tapping Class', type: 'image' },
  { fileId: '1uQaBOSPr2_xiCvinROitIZmjCvPpjZ-V', title: 'FBK Fall 2011 Tapping Class',   type: 'image' },
  { fileId: '1cBHDRuWw8aMvuW9teq2G2C8P70ccuXug', title: 'FBK Spring 2011 Tapping Class', type: 'image' },
  { fileId: '12uO5D5F8zoldvlE-ehIRTINiXOF8EQ2-', title: 'FBK Fall 2012 Tapping Class',   type: 'image' },
  { fileId: '1tSEO6Sts28VVMNybVHPIFBql39Yl5yzO', title: 'FBK Spring 2012 Tapping Class', type: 'image' },
  { fileId: '1ZQZj4sOPoik03Rz-PhrhbDDb4u7c5suu', title: 'FBK Fall 2013 Tapping Class',   type: 'image' },
  { fileId: '1-q-_WonO5E3ObGLwoufhhyAvDL7tOdCI', title: 'FBK Spring 2013 Tapping Class', type: 'image' },
  { fileId: '1dGkm8DEmfyrbuLldejjfQD0Fk0oty2E-', title: 'FBK Fall 2014 Tapping Class',   type: 'image' },
  { fileId: '1GFgWQ6tpjgcGDwsW3yS3vFwKCqMVG8sK', title: 'FBK Spring 2014 Tapping Class', type: 'image' },
  { fileId: '1zO2XC6XDFy7-fMsm68O5g3QfhgROjnsW', title: 'FBK Fall 2015 Tapping Class',   type: 'image' },
  { fileId: '1On6BBewJEaAh6ZzB5-gxJRuxQEF0u859', title: 'FBK Spring 2015 Tapping Class', type: 'image' },
  { fileId: '1cmmSReAAwLTs7mqoVAbehCab5TT1HjV3', title: 'FBK Fall 2016 Tapping Class',   type: 'image' },
  { fileId: '17gdcVqNFqxdUVdY1SgFskukcAHbxqPCL', title: 'FBK Spring 2016 Tapping Class', type: 'image' },
  { fileId: '13pVIrV4BbovXDKE1L79iFimStsjUokwC', title: 'FBK Fall 2017 Tapping Class',   type: 'image' },
  { fileId: '1ZUfiozLnqmIQpGuKYqajEUsQi-6J4Bip', title: 'FBK Spring 2017 Tapping Class', type: 'image' },
  { fileId: '1gc93X91dChMGxvdjiQlp0PG_ZtY8Trcc', title: 'FBK Fall 2018 Tapping Class',   type: 'image' },
  { fileId: '1s9umP-L5SlQo9ibeL6VEYoToGGHXP7uV', title: 'FBK Spring 2018 Tapping Class', type: 'image' },
  { fileId: '1Z8INkHA_gsUiSHg_xaUrR2gbZjjdrXW-', title: 'FBK Fall 2019 Tapping Class',   type: 'image' },
  { fileId: '1jx7KomG1PjuuaphWKNGLg7KEEGjMr6C9', title: 'FBK Spring 2019 Tapping Class', type: 'image' },
  { fileId: '1JePnfvhjUNX0SsOGGCB2yDUfbFNGJ4T7', title: 'FBK Spring 2020 Tapping Class', type: 'image' },
  // ── New PDF files ──────────────────────────────────────────────────────────
  { fileId: '1xAceUZOwjTvljIryfsMY24S4rbDX1-Nf', title: 'FBK Fall 2025 Tapping Class',   type: 'pdf' },
  { fileId: '1OEh2CI5pd8BSvlyvcnbd2Iu4DKBqzMyF', title: 'FBK Spring 2026 Tapping Class', type: 'pdf' },
  { fileId: '1SOkB7r0tAVIA1yI8EoV9Hx31v87g0EnM', title: 'FBK Tapping Classes 1923-2007', type: 'pdf' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 150;
const CHUNK_OVERLAP = 30;

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = start + CHUNK_SIZE;
    let chunk = normalized.slice(start, end);
    if (end < normalized.length) {
      const wordBreak = chunk.lastIndexOf(' ');
      if (wordBreak > CHUNK_SIZE * 0.5) chunk = chunk.slice(0, wordBreak);
    }
    const trimmed = chunk.trim();
    if (trimmed.length >= 40) chunks.push(trimmed);
    const advance = chunk.length - CHUNK_OVERLAP;
    start += advance > 0 ? advance : chunk.length;
  }
  return chunks;
}

function splitFusedNames(line: string): string[] {
  const split = line.replace(/([a-záàâãéèêíïóôõöúüñç])([A-ZÁÀÂÃÉÈÍÏÓÔÕÖÚÜÑÇ])/g, '$1\u0000$2');
  const parts = split.split('\u0000').map((s) => s.trim()).filter((s) => s.length > 2);
  return parts.filter((p) => /^[A-ZÁÀÂÃÉÈÍÏÓÔÕÖÚÜÑÇ]/.test(p) && p.split(' ').length >= 2 && p.split(' ').length <= 5);
}

function extractMemberSentences(text: string, title: string): string[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const names = new Set<string>();
  const nameRe = /^([A-Z][a-zA-Záàâãéèêíïóôõöúüñç'\-]+(?:\s[A-Z][a-zA-Záàâãéèêíïóôõöúüñç'\-]+)+)$/;
  const lastFirstRe = /^([A-Z][a-zA-Záàâãéèêíïóôõöúüñç'\-]+),\s*([A-Z][a-zA-Záàâãéèêíïóôõöúüñç'\-]+.*)$/;

  for (const line of lines) {
    if (line.length > 8 && /[a-z][A-Z]/.test(line)) {
      const parts = splitFusedNames(line);
      if (parts.length > 1) { parts.forEach((p) => names.add(p)); continue; }
    }
    const lastFirst = line.match(lastFirstRe);
    if (lastFirst) { names.add(`${lastFirst[2].trim()} ${lastFirst[1].trim()}`); continue; }
    const words = line.split(' ');
    if (words.length >= 2 && words.length <= 5 && nameRe.test(line)) names.add(line);
  }

  if (names.size < 3) return chunkText(text);

  const sentences = [...names].map((name) => `${name} was inducted into Florida Blue Key in the ${title}.`);
  const summary = `${title} members: ${[...names].join(', ')}`;
  return [...sentences, ...chunkText(summary)];
}

async function embed(text: string): Promise<number[]> {
  const r = await openaiClient.embeddings.create({
    model: 'nomic-embed-text-v1.5',
    input: text.replace(/\n/g, ' '),
  });
  return r.data[0].embedding;
}

async function ingestChunks(
  docId: string,
  chunks: string[],
  title: string,
  sourceUrl: string
): Promise<void> {
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const rows = await Promise.all(batch.map(async (content, j) => ({
      id: uuidv4(),
      document_id: docId,
      content,
      metadata: { title, source_url: sourceUrl, chunk_index: i + j },
      embedding: await embed(content),
    })));
    await supabase.from('document_chunks').insert(rows);
  }
}

async function upsertDocument(title: string, sourceUrl: string): Promise<string> {
  const { data: existing } = await supabase.from('documents').select('id').eq('source_url', sourceUrl).maybeSingle();
  if (existing) {
    await supabase.from('documents').update({ title, status: 'pending' }).eq('id', existing.id);
    await supabase.from('document_chunks').delete().eq('document_id', existing.id);
    return existing.id;
  }
  const { data: newDoc, error } = await supabase.from('documents')
    .insert({ title, source_url: sourceUrl, mime_type: 'image/png', status: 'pending' })
    .select('id').single();
  if (error || !newDoc) throw new Error(error?.message ?? 'DB insert failed');
  return newDoc.id;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const tmpDir = '/tmp/fbk-tapping';
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// One shared Playwright browser for downloads
const browser = await chromium.launch({ headless: true });

// One shared Tesseract worker for OCR
console.log('Initializing OCR engine...');
const ocrWorker = await createWorker('eng');
console.log('OCR ready.\n');

let successCount = 0;
let failCount = 0;

for (const { fileId, title, type } of CATALOG) {
  const sourceUrl = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
  const tmpFile = path.join(tmpDir, `${fileId}.tmp`);
  console.log(`\n[${title}]`);

  try {
    // ── Download ──────────────────────────────────────────────────────────────
    if (!fs.existsSync(tmpFile)) {
      const context = await browser.newContext({ acceptDownloads: true });
      const page = await context.newPage();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20000 }),
        page.goto(`https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`).catch(() => {}),
      ]);
      await download.saveAs(tmpFile);
      await context.close();
      console.log(`  Downloaded (${fs.statSync(tmpFile).size} bytes)`);
    } else {
      console.log(`  Using cached file`);
    }

    // ── Extract text ──────────────────────────────────────────────────────────
    let text = '';
    if (type === 'image') {
      const { data: { text: ocrText } } = await ocrWorker.recognize(tmpFile);
      text = ocrText;
      console.log(`  OCR complete (${text.length} chars)`);
    } else {
      const buf = fs.readFileSync(tmpFile);
      const parsed = await pdfParse(buf);
      text = parsed.text;
      console.log(`  PDF parsed (${text.length} chars)`);
    }

    if (!text || text.trim().length < 20) {
      console.log('  ✗ No text extracted');
      failCount++;
      continue;
    }

    // ── Ingest ────────────────────────────────────────────────────────────────
    const docId = await upsertDocument(title, sourceUrl);
    await supabase.from('documents').update({ status: 'ingesting' }).eq('id', docId);

    const chunks = extractMemberSentences(text, title);
    await ingestChunks(docId, chunks, title, sourceUrl);

    await supabase.from('documents')
      .update({ status: 'ingested', ingested_at: new Date().toISOString() })
      .eq('id', docId);

    const memberCount = chunks.filter((c) => c.includes(' was inducted ')).length;
    console.log(`  ✓ ${chunks.length} chunks (${memberCount} individual members)`);
    successCount++;
  } catch (e) {
    console.log(`  ✗ ${(e as Error).message.slice(0, 100)}`);
    failCount++;
  }
}

await ocrWorker.terminate();
await browser.close();

console.log(`\n✅ Done: ${successCount} ingested, ${failCount} failed.`);
