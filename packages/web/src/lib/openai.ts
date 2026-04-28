import OpenAI from 'openai';

// NaviGator client — used for both embeddings and chat completions
export const openai = new OpenAI({
  apiKey: process.env.NAVIGATOR_API_KEY ?? 'missing',
  baseURL: process.env.NAVIGATOR_BASE_URL,
});

export const EMBEDDING_MODEL = 'nomic-embed-text-v1.5';
export const CHAT_MODEL = process.env.CHAT_MODEL ?? 'gpt-oss-20b';

export async function createEmbedding(text: string, _task?: 'document' | 'query'): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.replace(/\n/g, ' '),
  });
  return response.data[0].embedding;
}
