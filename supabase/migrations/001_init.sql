-- ============================================================
-- FBK Chatbot – initial schema
-- Run this in the Supabase SQL editor or via the CLI:
--   supabase db push
-- ============================================================

-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ─── documents ───────────────────────────────────────────────────────────────
create table if not exists documents (
  id          uuid        primary key default uuid_generate_v4(),
  title       text        not null,
  source_url  text,
  mime_type   text        not null default 'text/plain',
  file_path   text,
  status      text        not null default 'pending'
                          check (status in ('pending','ingesting','ingested','error')),
  error_msg   text,
  ingested_at timestamptz,
  created_at  timestamptz not null default now()
);

-- ─── document_chunks ─────────────────────────────────────────────────────────
create table if not exists document_chunks (
  id          uuid        primary key default uuid_generate_v4(),
  document_id uuid        not null references documents(id) on delete cascade,
  content     text        not null,
  metadata    jsonb       not null default '{}',
  embedding   vector(768),
  created_at  timestamptz not null default now()
);

-- IVFFlat index for cosine similarity (tune lists= based on row count)
create index if not exists document_chunks_embedding_idx
  on document_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ─── chat_sessions ───────────────────────────────────────────────────────────
create table if not exists chat_sessions (
  id         uuid        primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

-- ─── chat_messages ───────────────────────────────────────────────────────────
create table if not exists chat_messages (
  id         uuid        primary key default uuid_generate_v4(),
  session_id uuid        not null references chat_sessions(id) on delete cascade,
  role       text        not null check (role in ('user','assistant')),
  content    text        not null,
  sources    jsonb       not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_idx on chat_messages(session_id);

-- ─── chat_feedback ───────────────────────────────────────────────────────────
create table if not exists chat_feedback (
  id         uuid        primary key default uuid_generate_v4(),
  session_id uuid        references chat_sessions(id),
  message_id uuid        references chat_messages(id),
  rating     text        not null check (rating in ('up','down')),
  category   text,
  comment    text,
  created_at timestamptz not null default now()
);

-- ─── RPC: similarity search ──────────────────────────────────────────────────
create or replace function match_document_chunks(
  query_embedding  vector(768),
  match_count      int     default 5,
  match_threshold  float   default 0.45
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

-- ─── Storage bucket policies (run AFTER creating bucket in dashboard) ─────────
-- Create a bucket named "docs" in the Supabase dashboard, then run:
--
-- insert into storage.buckets (id, name, public)
-- values ('docs', 'docs', false)
-- on conflict do nothing;
--
-- create policy "service role full access"
-- on storage.objects for all
-- using (auth.role() = 'service_role');
