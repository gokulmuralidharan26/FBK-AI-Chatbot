import { createClient } from '@supabase/supabase-js';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing env: SUPABASE_SERVICE_ROLE_KEY');
}

/**
 * Server-side Supabase client that bypasses RLS.
 * Never expose this to the browser.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
  }
);

// ─── Type helpers ─────────────────────────────────────────────────────────────

export interface Document {
  id: string;
  title: string;
  source_url: string | null;
  mime_type: string;
  file_path: string | null;
  status: 'pending' | 'ingesting' | 'ingested' | 'error';
  error_msg: string | null;
  ingested_at: string | null;
  created_at: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  content: string;
  metadata: {
    title: string;
    source_url: string | null;
    chunk_index: number;
  };
  similarity?: number;
}

export interface ChatSession {
  id: string;
  created_at: string;
  last_seen: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
  created_at: string;
}

export interface Source {
  title: string;
  url: string;
  snippet: string;
}
