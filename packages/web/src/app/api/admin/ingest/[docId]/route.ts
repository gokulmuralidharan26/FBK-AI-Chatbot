import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { ingestDocument } from '@/lib/ingest';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params;

  // Fetch the document record
  const { data: doc, error: fetchError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', docId)
    .single();

  if (fetchError || !doc) {
    return Response.json({ error: 'Document not found' }, { status: 404 });
  }

  if (!doc.file_path) {
    return Response.json({ error: 'Document has no associated file' }, { status: 400 });
  }

  // Download the file from Supabase Storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('docs')
    .download(doc.file_path);

  if (downloadError || !fileData) {
    return Response.json(
      { error: `Failed to download file: ${downloadError?.message}` },
      { status: 500 }
    );
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());

  // Run ingestion (this is the same pipeline as the CLI ingest script)
  try {
    await ingestDocument({
      documentId: docId,
      title: doc.title,
      sourceUrl: doc.source_url ?? null,
      buffer,
      mimeType: doc.mime_type,
    });
    return Response.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ingestion failed';
    return Response.json({ error: msg }, { status: 500 });
  }
}
