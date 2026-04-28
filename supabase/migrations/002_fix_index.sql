-- Fix the IVFFlat index which becomes stale when rows < lists*10.
-- Replace with HNSW which is dynamic and does not require rebuilding.
-- Run this once in the Supabase SQL Editor.

-- Drop the old IVFFlat index
drop index if exists document_chunks_embedding_idx;

-- Create an HNSW index (pgvector >= 0.5.0, available on Supabase since 2023)
-- HNSW is self-balancing and works correctly for any dataset size.
create index document_chunks_embedding_hnsw_idx
  on document_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Lower the default match_threshold so zero-threshold queries always work
create or replace function match_document_chunks(
  query_embedding  vector(768),
  match_count      int     default 10,
  match_threshold  float   default 0.0
)
returns table (
  id           uuid,
  document_id  uuid,
  content      text,
  metadata     jsonb,
  similarity   float
)
language sql stable
as $$
  select
    dc.id,
    dc.document_id,
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  where 1 - (dc.embedding <=> query_embedding) > match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
