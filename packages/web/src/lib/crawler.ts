import * as cheerio from 'cheerio';
import { supabase } from './supabase';
import { ingestDocument } from './ingest';

const MAX_PAGES = 150;
const CRAWL_DELAY_MS = 300;

export interface CrawlProgress {
  type: 'page' | 'done' | 'error';
  url?: string;
  title?: string;
  status?: 'ingested' | 'skipped' | 'error';
  message?: string;
  total?: number;
}

function getHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

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
  const skipExts = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp',
    '.css', '.js', '.xml', '.zip', '.mp4', '.mp3', '.mov'];
  if (skipExts.some((ext) => lower.split('?')[0].endsWith(ext))) return true;
  if (lower.includes('/wp-json/') || lower.includes('/feed/') ||
      lower.includes('/wp-admin/') || lower.includes('mailto:') ||
      lower.includes('tel:')) return true;
  return false;
}

export async function* crawlSite(startUrl: string): AsyncGenerator<CrawlProgress> {
  const baseHostname = getHostname(startUrl);
  const visited = new Set<string>();
  const queue: string[] = [startUrl];
  let pageCount = 0;

  while (queue.length > 0 && pageCount < MAX_PAGES) {
    const url = queue.shift()!;
    if (visited.has(url) || shouldSkip(url)) continue;
    visited.add(url);

    // Only crawl same domain
    if (getHostname(url) !== baseHostname) continue;

    try {
      await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS));

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) {
        yield { type: 'page', url, status: 'skipped', message: `HTTP ${res.status}` };
        continue;
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html')) {
        yield { type: 'page', url, status: 'skipped', message: 'Not HTML' };
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
        if (getHostname(normalized) !== baseHostname) return;
        if (!visited.has(normalized) && !queue.includes(normalized)) {
          queue.push(normalized);
        }
      });

      const title = $('title').text().trim() ||
        $('h1').first().text().trim() ||
        url;

      // Remove boilerplate, keep main content
      $('script, style, noscript, iframe, nav, footer, header, ' +
        '.nav, .menu, .footer, .header, .sidebar, .widget, ' +
        '[role="navigation"], [role="banner"], [role="contentinfo"]').remove();

      const text = $('body').text().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

      if (text.length < 150) {
        yield { type: 'page', url, title, status: 'skipped', message: 'Too little content' };
        continue;
      }

      // Upsert document record
      const { data: existing } = await supabase
        .from('documents')
        .select('id')
        .eq('source_url', url)
        .maybeSingle();

      let documentId: string;

      if (existing) {
        documentId = existing.id;
        await supabase.from('documents')
          .update({ title, status: 'pending', error_msg: null })
          .eq('id', documentId);
      } else {
        const { data: newDoc, error } = await supabase
          .from('documents')
          .insert({ title, source_url: url, mime_type: 'text/plain', status: 'pending' })
          .select('id')
          .single();
        if (error || !newDoc) {
          yield { type: 'page', url, status: 'error', message: 'Failed to create document record' };
          continue;
        }
        documentId = newDoc.id;
      }

      await ingestDocument({
        documentId,
        title,
        sourceUrl: url,
        buffer: Buffer.from(text, 'utf-8'),
        mimeType: 'text/plain',
      });

      pageCount++;
      yield { type: 'page', url, title, status: 'ingested' };

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      yield { type: 'page', url, status: 'error', message };
    }
  }

  yield { type: 'done', total: pageCount };
}
