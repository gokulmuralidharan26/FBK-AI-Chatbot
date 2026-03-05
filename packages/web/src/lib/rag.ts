import { gemini, CHAT_MODEL, createEmbedding } from './openai';
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

const SYSTEM_PROMPT = `You are FBK Assistant, a friendly and knowledgeable AI helper for Florida Blue Key (FBK), a prestigious honorary leadership organization at the University of Florida (fbk.org).

RULES (follow strictly):
1. Only answer questions related to FBK, its programs, services, events, members, and community.
2. Answer using the CONTEXT provided first. If the context has the answer, use it. If not, use your own training knowledge about FBK and UF to answer as best you can.
3. NEVER fabricate specific private data such as member contact information, internal records, or confidential documents.
4. ONLY include URLs that appear in the provided CONTEXT or the LINK ALLOWLIST below. Do NOT invent or hallucinate any other URLs.
5. If a question is completely outside your knowledge and not in the context, say "I don't have that specific information — please contact FBK at contact@fbk.org."
6. Be concise, warm, and professional. Format responses with markdown when helpful.
7. When listing names from documents, only include names that appear as complete first AND last name pairs. Ignore any single-word entries — these are document parsing artifacts, not real names.
8. Do NOT add any JSON, XML, or metadata blocks to your response. Output only the answer text.

LINK ALLOWLIST (you may always reference these):
${LINK_ALLOWLIST.map((u) => `- ${u}`).join('\n')}`;

export async function retrieveChunks(query: string, k = 5): Promise<DocumentChunk[]> {
  let embedding: number[];

  try {
    embedding = await createEmbedding(query, 'query');
  } catch (err) {
    // If the embedding API is unavailable, skip RAG and let the LLM answer from its own knowledge
    console.warn('Embedding unavailable, skipping RAG:', (err as Error).message);
    return [];
  }

  const { data, error } = await supabase.rpc('match_document_chunks', {
    query_embedding: embedding,
    match_count: k,
    match_threshold: 0.0,
  });

  if (error) {
    console.error('pgvector search error:', error);
    return [];
  }

  console.log(`RAG: query="${query}" → ${(data ?? []).length} chunks found`);
  if (data?.length) {
    (data as DocumentChunk[]).forEach((c, i) => {
      console.log(`  [${i}] similarity=${(c as unknown as { similarity: number }).similarity?.toFixed(3)} title="${c.metadata.title}"`);
    });
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

  const stream = await gemini.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    stream: true,
    temperature: 0.3,
    max_tokens: 1024,
  });

  return { stream, sources };
}

export function parseSourcesFromReply(
  fullText: string,
  ragSources: Source[]
): { cleanText: string; sources: Source[] } {
  // Strip any stray SOURCES_JSON blocks the model may output despite instructions
  const cleanText = fullText
    .replace(/<!--SOURCES_JSON[\s\S]*?SOURCES_JSON-->/g, '')
    .replace(/\n{1,2}\*{0,2}Sources?\*{0,2}\s*\n*/gi, '')
    .trim();
  return { cleanText, sources: ragSources };
}
