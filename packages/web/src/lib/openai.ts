import OpenAI from 'openai';

if (!process.env.NAVIGATOR_API_KEY) {
  throw new Error('Missing env: NAVIGATOR_API_KEY');
}

// NaviGator client — used for embeddings only
export const openai = new OpenAI({
  apiKey: process.env.NAVIGATOR_API_KEY,
  baseURL: process.env.NAVIGATOR_BASE_URL,
});

// Gemini client — used for chat completions
// Gemini exposes an OpenAI-compatible endpoint so we can reuse the same SDK
export const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY ?? '',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

export const EMBEDDING_MODEL = 'nomic-embed-text-v1.5';
export const CHAT_MODEL = process.env.CHAT_MODEL ?? 'gemini-2.0-flash';

export async function createEmbedding(text: string, _task?: 'document' | 'query'): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.replace(/\n/g, ' '),
  });
  return response.data[0].embedding;
}
