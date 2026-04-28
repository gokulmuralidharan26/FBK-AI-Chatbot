import { NextRequest } from 'next/server';
import { retrieveChunks } from '@/lib/rag';
import { supabase } from '@/lib/supabase';
import { createEmbedding } from '@/lib/openai';

export const runtime = 'nodejs';

// Simple debug endpoint — remove after diagnosing
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q') ?? 'gokul muralidharan fall 2024 tapping class';

  const results: Record<string, unknown> = {};

  // 1. Check document count
  const { count: docCount } = await supabase
    .from('documents').select('*', { count: 'exact', head: true });
  results.documentCount = docCount;

  // 2. Check chunk count
  const { count: chunkCount } = await supabase
    .from('document_chunks').select('*', { count: 'exact', head: true });
  results.chunkCount = chunkCount;

  // 3. Check for gokul in chunks
  const { data: gokulChunks } = await supabase
    .from('document_chunks').select('content, metadata').ilike('content', '%Gokul%').limit(3);
  results.gokulChunks = gokulChunks?.map(c => ({ title: c.metadata?.title, content: c.content?.slice(0, 150) }));

  // 4. Try embedding
  let embedding: number[] | null = null;
  let embeddingError: string | null = null;
  try {
    embedding = await createEmbedding(query);
    results.embeddingDimensions = embedding.length;
  } catch (e) {
    embeddingError = (e as Error).message;
    results.embeddingError = embeddingError;
  }

  // 5. Try RPC
  if (embedding) {
    const { data, error } = await supabase.rpc('match_document_chunks', {
      query_embedding: embedding,
      match_count: 3,
      match_threshold: 0.0,
    });
    results.rpcError = error?.message ?? null;
    results.rpcResults = (data ?? []).map((c: any) => ({
      title: c.metadata?.title,
      similarity: c.similarity,
      content: c.content?.slice(0, 100),
    }));
  }

  // 6. Try retrieveChunks
  try {
    const chunks = await retrieveChunks(query, 3);
    results.retrieveChunksCount = chunks.length;
    results.retrieveChunksTitles = chunks.map(c => c.metadata.title);
  } catch (e) {
    results.retrieveChunksError = (e as Error).message;
  }

  return Response.json(results, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
