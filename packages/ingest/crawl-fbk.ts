#!/usr/bin/env tsx
/**
 * Local crawler — fetches every page on fbk.org and ingests it into Supabase.
 * Run from the project root:
 *   npx tsx packages/ingest/crawl-fbk.ts
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

// Load from packages/web/.env.local
config({ path: path.resolve(__dirname, '../web/.env.local') });

const START_URL = 'https://fbk.org';
const MAX_PAGES = 150;
const CRAWL_DELAY_MS = 400;
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

// ─── Text utilities ───────────────────────────────────────────────────────────

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

// ─── Crawler ──────────────────────────────────────────────────────────────────

function normalizeUrl(href: string, base: string): string | null {
  try {
    const parsed = new URL(href, base);
    parsed.hash = '';
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch { return null; }
}

function shouldSkip(url: string): boolean {
  const lower = url.toLowerCase();
  const skipExts = ['.pdf','.jpg','.jpeg','.png','.gif','.svg','.webp',
    '.css','.js','.xml','.zip','.mp4','.mp3','.mov'];
  if (skipExts.some((ext) => lower.split('?')[0].endsWith(ext))) return true;
  if (lower.includes('/wp-json/') || lower.includes('/feed/') ||
      lower.includes('/wp-admin/') || lower.includes('mailto:') ||
      lower.includes('tel:')) return true;
  return false;
}

async function ingestPage(documentId: string, title: string, sourceUrl: string, text: string) {
  // Delete old chunks
  await supabase.from('document_chunks').delete().eq('document_id', documentId);

  await supabase.from('documents').update({ status: 'ingesting' }).eq('id', documentId);

  const chunks = chunkText(text);

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const rows = await Promise.all(
      batch.map(async (content, j) => {
        const textToEmbed = `${title}: ${content}`;
        const embedding = await createEmbedding(textToEmbed);
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
}

async function crawl() {
  const visited = new Set<string>();
  const queue: string[] = [START_URL];
  const baseHostname = new URL(START_URL).hostname;
  let pageCount = 0;
  let errorCount = 0;

  console.log(`\nStarting crawl of ${START_URL}`);
  console.log('─'.repeat(60));

  while (queue.length > 0 && pageCount < MAX_PAGES) {
    const url = queue.shift()!;
    if (visited.has(url) || shouldSkip(url)) continue;
    visited.add(url);
    if (new URL(url).hostname !== baseHostname) continue;

    await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS));

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) {
        console.log(`  [SKIP] ${url} — HTTP ${res.status}`);
        continue;
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html')) {
        continue;
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      // Enqueue internal links
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const normalized = normalizeUrl(href, url);
        if (!normalized) return;
        if (new URL(normalized).hostname !== baseHostname) return;
        if (!visited.has(normalized) && !queue.includes(normalized)) {
          queue.push(normalized);
        }
      });

      const title = $('title').text().trim() || $('h1').first().text().trim() || url;

      $('script, style, noscript, iframe, nav, footer, header, ' +
        '.nav, .menu, .footer, .header, .sidebar, .widget, ' +
        '[role="navigation"], [role="banner"], [role="contentinfo"]').remove();

      const text = $('body').text().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

      if (text.length < 150) {
        console.log(`  [SKIP] ${title} — too little content`);
        continue;
      }

      // Upsert document record
      const { data: existing } = await supabase
        .from('documents').select('id').eq('source_url', url).maybeSingle();

      let documentId: string;
      if (existing) {
        documentId = existing.id;
        await supabase.from('documents').update({ title, status: 'pending', error_msg: null }).eq('id', documentId);
      } else {
        const { data: newDoc, error } = await supabase
          .from('documents')
          .insert({ title, source_url: url, mime_type: 'text/plain', status: 'pending' })
          .select('id').single();
        if (error || !newDoc) {
          console.log(`  [ERROR] Failed to create record for ${url}: ${error?.message}`);
          errorCount++;
          continue;
        }
        documentId = newDoc.id;
      }

      await ingestPage(documentId, title, url, text);
      pageCount++;
      console.log(`  [${pageCount}] ✓ ${title}`);

    } catch (err) {
      console.log(`  [ERROR] ${url} — ${(err as Error).message}`);
      errorCount++;
    }
  }

  console.log('─'.repeat(60));
  console.log(`\nDone! Ingested ${pageCount} pages, ${errorCount} errors.`);
}

crawl().catch(console.error);
