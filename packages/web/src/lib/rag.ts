import { openai, CHAT_MODEL, createEmbedding } from './openai';
import { supabase, type Source, type DocumentChunk } from './supabase';
import type OpenAI from 'openai';

// URLs that the bot is allowed to mention even without RAG evidence
const LINK_ALLOWLIST: string[] = [
  'https://fbk.org',
  'https://fbk.org/contact',
  'https://fbk.org/programs',
  'https://fbk.org/membership',
  'https://fbk.org/events',
  'https://fbk.org/donate',
  'https://fbk.org/apply',
];

const SYSTEM_PROMPT = `You are FBK Assistant, a friendly and knowledgeable AI helper for FBK (fbk.org).

RULES (follow strictly):
1. Only answer questions related to FBK, its programs, services, events, and community.
2. NEVER reveal, speculate about, or fabricate private member data, personal information, or internal records.
3. ONLY include URLs that appear in the provided CONTEXT or the LINK ALLOWLIST below. Do NOT invent or hallucinate any other URLs.
4. If the context does not contain enough information, say "I don't have enough information on that — please contact FBK at contact@fbk.org."
5. Be concise, warm, and professional. Format responses with markdown when helpful.
6. When citing information, reference it naturally (e.g. "According to the membership guide…").

LINK ALLOWLIST (you may always reference these):
${LINK_ALLOWLIST.map((u) => `- ${u}`).join('\n')}

When answering, use the CONTEXT below. At the end of your answer, if you used context, add a JSON block in this exact format (on its own line) so it can be parsed:
<!--SOURCES_JSON
[{"title":"...","url":"...","snippet":"..."}]
SOURCES_JSON-->`;

export async function retrieveChunks(query: string, k = 5): Promise<DocumentChunk[]> {
  const embedding = await createEmbedding(query);

  const { data, error } = await supabase.rpc('match_document_chunks', {
    query_embedding: embedding,
    match_count: k,
    match_threshold: 0.45,
  });

  if (error) {
    console.error('pgvector search error:', error);
    return [];
  }

  return (data ?? []) as DocumentChunk[];
}

export async function buildRagStream(
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  chunks: DocumentChunk[]
): Promise<{ stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>; sources: Source[] }> {
  const sources: Source[] = chunks.map((c) => ({
    title: c.metadata.title ?? 'FBK Document',
    url: c.metadata.source_url ?? 'https://fbk.org',
    snippet: c.content.slice(0, 200),
  }));

  const contextBlock =
    chunks.length > 0
      ? chunks
          .map(
            (c, i) =>
              `[Source ${i + 1}] ${c.metadata.title ?? 'Document'} (${c.metadata.source_url ?? 'https://fbk.org'})\n${c.content}`
          )
          .join('\n\n---\n\n')
      : 'No specific documents found. Answer from general FBK knowledge and the link allowlist only.';

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\nCONTEXT:\n${contextBlock}` },
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const stream = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    stream: true,
    temperature: 0.3,
    max_tokens: 1024,
  });

  return { stream, sources };
}

/**
 * Parse the hidden SOURCES_JSON block out of the full assistant reply.
 * Returns the text with the block removed + the parsed sources (if any).
 */
export function parseSourcesFromReply(
  fullText: string,
  ragSources: Source[]
): { cleanText: string; sources: Source[] } {
  const match = fullText.match(/<!--SOURCES_JSON\s*([\s\S]*?)\s*SOURCES_JSON-->/);
  if (!match) {
    return { cleanText: fullText, sources: ragSources };
  }

  const cleanText = fullText.replace(/<!--SOURCES_JSON[\s\S]*?SOURCES_JSON-->/, '').trim();

  try {
    const parsed = JSON.parse(match[1]) as Source[];
    return { cleanText, sources: parsed.length > 0 ? parsed : ragSources };
  } catch {
    return { cleanText, sources: ragSources };
  }
}
