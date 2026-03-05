import { supabase } from './supabase';
import { createEmbedding } from './openai';

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;

// ─── Text extraction ──────────────────────────────────────────────────────────

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    const { extractText: pdfExtractText } = await import('unpdf');
    const uint8 = new Uint8Array(buffer);
    const { text } = await pdfExtractText(uint8, { mergePages: true });
    return text;
  }

  // Plain text / markdown
  return buffer.toString('utf-8');
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  // Normalise whitespace but keep paragraph structure
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  let start = 0;
  while (start < normalized.length) {
    const end = start + CHUNK_SIZE;
    let chunk = normalized.slice(start, end);

    if (end < normalized.length) {
      // Prefer sentence boundary
      const sentenceBreak = chunk.search(/[.!?\n]\s+\S[^.!?\n]{50,}$/);
      if (sentenceBreak > CHUNK_SIZE * 0.6) {
        chunk = chunk.slice(0, sentenceBreak + 1);
      } else {
        // Fall back to word boundary — never split mid-word
        const wordBreak = chunk.lastIndexOf(' ');
        if (wordBreak > CHUNK_SIZE * 0.5) {
          chunk = chunk.slice(0, wordBreak);
        }
      }
    }

    const trimmed = chunk.trim();
    if (trimmed.length >= 40) {
      chunks.push(trimmed);
    }

    const advance = chunk.length - CHUNK_OVERLAP;
    start += advance > 0 ? advance : chunk.length;
  }

  return chunks;
}

// ─── Main ingestion pipeline ──────────────────────────────────────────────────

export async function ingestDocument(params: {
  documentId: string;
  title: string;
  sourceUrl: string | null;
  buffer: Buffer;
  mimeType: string;
}): Promise<void> {
  const { documentId, title, sourceUrl, buffer, mimeType } = params;

  // Mark as ingesting
  await supabase
    .from('documents')
    .update({ status: 'ingesting' })
    .eq('id', documentId);

  try {
    const text = await extractText(buffer, mimeType);
    const chunks = chunkText(text);

    // Remove old chunks for this document (re-ingestion support)
    await supabase.from('document_chunks').delete().eq('document_id', documentId);

    // Batch embed + insert
    const BATCH_SIZE = 20;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      const rows = await Promise.all(
        batch.map(async (content, j) => {
          // Prepend the document title so embeddings carry document context
          const textToEmbed = `${title}: ${content}`;
          const embedding = await createEmbedding(textToEmbed);
          return {
            document_id: documentId,
            content,
            metadata: {
              title,
              source_url: sourceUrl,
              chunk_index: i + j,
            },
            embedding: JSON.stringify(embedding),
          };
        })
      );

      const { error } = await supabase.from('document_chunks').insert(rows);
      if (error) throw error;
    }

    await supabase
      .from('documents')
      .update({ status: 'ingested', ingested_at: new Date().toISOString() })
      .eq('id', documentId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('documents')
      .update({ status: 'error', error_msg: msg })
      .eq('id', documentId);
    throw err;
  }
}
