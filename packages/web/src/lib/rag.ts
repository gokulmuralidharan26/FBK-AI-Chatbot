import { openai as gemini, CHAT_MODEL, createEmbedding } from './openai';
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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * (b[i] ?? 0);
    magA += a[i] ** 2;
    magB += (b[i] ?? 0) ** 2;
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

export async function retrieveChunks(query: string, k = 10): Promise<DocumentChunk[]> {
  let embedding: number[];

  try {
    embedding = await createEmbedding(query, 'query');
  } catch (err) {
    console.warn('Embedding unavailable, skipping RAG:', (err as Error).message);
    return [];
  }

  // Try the vector index first
  const { data: rpcData, error: rpcError } = await supabase.rpc('match_document_chunks', {
    query_embedding: embedding,
    match_count: k,
    match_threshold: 0.0,
  });

  // If the index returned a healthy set of results, trust it
  const minExpected = Math.min(k, 5);
  if (!rpcError && rpcData && (rpcData as DocumentChunk[]).length >= minExpected) {
    const results = rpcData as DocumentChunk[];
    console.log(`RAG (index): query="${query}" → ${results.length} chunks`);
    results.forEach((c, i) =>
      console.log(`  [${i}] sim=${(c as unknown as { similarity: number }).similarity?.toFixed(3)} title="${c.metadata.title}"`)
    );
    return results;
  }

  // IVFFlat index returned too few results (likely stale after bulk inserts).
  // Fall back to fetching all chunks and computing similarity in JS.
  // With ~200 chunks this is fast (~1–2 MB, <200 ms latency).
  console.warn(`RAG: index returned ${rpcData?.length ?? 0}/${minExpected} expected results — falling back to full scan`);

  const { data: allChunks, error: scanError } = await supabase
    .from('document_chunks')
    .select('id, document_id, content, metadata, embedding');

  if (scanError || !allChunks) {
    console.error('Full-scan fallback failed:', scanError);
    return [];
  }

  const scored = (allChunks as Array<DocumentChunk & { embedding: string | number[] }>)
    .map((chunk) => {
      const raw = chunk.embedding;
      const chunkEmb: number[] = typeof raw === 'string' ? JSON.parse(raw) : (raw as number[]);
      return { chunk, sim: cosineSimilarity(embedding, chunkEmb) };
    })
    .filter((s) => s.sim > 0.3)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k);

  console.log(`RAG (JS scan): query="${query}" → ${scored.length} chunks`);
  scored.forEach(({ chunk, sim }, i) =>
    console.log(`  [${i}] sim=${sim.toFixed(3)} title="${chunk.metadata.title}"`)
  );

  return scored.map(({ chunk }) => chunk as DocumentChunk);
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
