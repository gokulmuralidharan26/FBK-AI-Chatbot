import { tavily } from '@tavily/core';
import { supabase } from './supabase';

let _client: ReturnType<typeof tavily> | null = null;

function getClient() {
  if (!_client) {
    const key = process.env.TAVILY_API_KEY;
    if (!key) throw new Error('TAVILY_API_KEY is not set');
    _client = tavily({ apiKey: key });
  }
  return _client;
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

/**
 * Check whether web search is enabled via the settings table.
 */
export async function isWebSearchEnabled(): Promise<boolean> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'tavily_enabled')
    .maybeSingle();
  return data?.value === 'true';
}

/**
 * Run a Tavily web search and return formatted context + source list.
 * Focuses results on FBK / UF-related topics when possible.
 */
export async function webSearch(
  query: string,
  maxResults = 5
): Promise<{ context: string; sources: TavilyResult[] }> {
  const client = getClient();

  const response = await client.search(query, {
    searchDepth: 'basic',
    maxResults,
    includeAnswer: false,
    includeDomains: [],
    excludeDomains: [],
  });

  const results: TavilyResult[] = (response.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    content: r.content ?? '',
    score: r.score ?? 0,
  }));

  const context = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`)
    .join('\n\n');

  return { context, sources: results };
}
