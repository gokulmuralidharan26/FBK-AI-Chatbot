#!/usr/bin/env tsx
/**
 * Downloads every tapping class PDF from fbk.org and ingests it into Supabase.
 * Uses Playwright to get the correct year/semester label for each PDF.
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;
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

async function createEmbedding(text: string): Promise<number[]> {
  const response = await openaiClient.embeddings.create({
    model: 'nomic-embed-text-v1.5',
    input: text.replace(/\n/g, ' '),
  });
  return response.data[0].embedding;
}

async function ingestPdf(title: string, sourceUrl: string, pdfBuffer: Buffer) {
  console.log(`    Ingesting "${title}"...`);

  // Upsert document record
  const { data: existing } = await supabase
    .from('documents').select('id').eq('source_url', sourceUrl).maybeSingle();

  let documentId: string;
  if (existing) {
    documentId = existing.id;
    await supabase.from('documents').update({ title, status: 'pending', error_msg: null }).eq('id', documentId);
    await supabase.from('document_chunks').delete().eq('document_id', documentId);
  } else {
    const { data: newDoc, error } = await supabase
      .from('documents')
      .insert({ title, source_url: sourceUrl, mime_type: 'application/pdf', status: 'pending' })
      .select('id').single();
    if (error || !newDoc) throw new Error(`DB insert failed: ${error?.message}`);
    documentId = newDoc.id;
  }

  // Extract text from PDF
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  if (!text || text.trim().length < 20) {
    await supabase.from('documents').update({ status: 'error', error_msg: 'No text extracted' }).eq('id', documentId);
    throw new Error('No text extracted from PDF');
  }

  await supabase.from('documents').update({ status: 'ingesting' }).eq('id', documentId);

  const chunks = chunkText(text);
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const rows = await Promise.all(
      batch.map(async (content, j) => {
        const embedding = await createEmbedding(`${title}: ${content}`);
        return {
          id: uuidv4(),
          document_id: documentId,
          content,
          metadata: { title, source_url: sourceUrl, chunk_index: i + j },
          embedding,
        };
      })
    );
    await supabase.from('document_chunks').insert(rows);
  }

  await supabase.from('documents')
    .update({ status: 'ingested', ingested_at: new Date().toISOString() })
    .eq('id', documentId);

  console.log(`    ✓ Done (${chunks.length} chunks, ${text.length} chars)`);
}

async function downloadGoogleDrivePdf(fileId: string): Promise<Buffer> {
  // Try direct download URL first
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const res = await fetch(downloadUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const contentType = res.headers.get('content-type') ?? '';
  // If it returns HTML, it's a "download warning" page for large files
  if (contentType.includes('text/html')) {
    // Try the export URL
    const altUrl = `https://drive.google.com/file/d/${fileId}/view`;
    throw new Error(`Got HTML response (large file warning), manual download may be needed`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('\nFetching tapping classes page...');
  await page.goto('https://www.fbk.org/tapping-classes', { waitUntil: 'networkidle', timeout: 25000 });
  await new Promise(r => setTimeout(r, 2000));

  // Extract year/semester label for each Google Drive link using DOM proximity
  const entries = await page.evaluate(() => {
    const results: Array<{ label: string; fileId: string; href: string }> = [];
    const seen = new Set<string>();

    // Find all Drive links
    const allLinks = Array.from(document.querySelectorAll('a[href*="drive.google.com/file/d/"]'));

    for (const link of allLinks) {
      const href = (link as HTMLAnchorElement).href;
      const match = href.match(/\/file\/d\/([^/]+)/);
      if (!match) continue;
      const fileId = match[1];
      if (seen.has(fileId)) continue;
      seen.add(fileId);

      // Find label: look at the button/link text, then parent container text
      const linkText = link.textContent?.trim() ?? '';
      let label = linkText;

      // Walk up to find year context
      let yearText = '';
      let el: Element | null = link.parentElement;
      for (let i = 0; i < 8; i++) {
        if (!el) break;
        const text = el.textContent?.trim() ?? '';
        const yearMatch = text.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) { yearText = yearMatch[0]; break; }
        el = el.parentElement;
      }

      // Also check previous siblings for Fall/Spring/year text
      let sibling: Element | null = link.closest('[class*="block"], [class*="section"], li, div') ?? link.parentElement;
      let contextText = sibling?.textContent?.trim().slice(0, 100) ?? '';

      results.push({ label: label || contextText || 'Unknown', fileId, href });
    }
    return results;
  });

  await browser.close();

  console.log(`Found ${entries.length} tapping class PDFs\n`);
  console.log('─'.repeat(60));

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < entries.length; i++) {
    const { label, fileId, href } = entries[i];
    const title = `FBK Tapping Class - ${label}`.replace(/\s+/g, ' ').trim();
    console.log(`[${i + 1}/${entries.length}] ${title}`);

    try {
      const pdfBuffer = await downloadGoogleDrivePdf(fileId);
      await ingestPdf(title, href, pdfBuffer);
      successCount++;
    } catch (err) {
      console.log(`    ✗ Error: ${(err as Error).message}`);
      errorCount++;
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('─'.repeat(60));
  console.log(`\nDone! ${successCount} PDFs ingested, ${errorCount} errors.`);
}

main().catch(console.error);
