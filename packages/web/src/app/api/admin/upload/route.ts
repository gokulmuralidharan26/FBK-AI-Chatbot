import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

function mimeFromName(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'md') return 'text/markdown';
  return 'text/plain';
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const title = (formData.get('title') as string | null)?.trim();
    const sourceUrl = (formData.get('sourceUrl') as string | null)?.trim() || null;

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!title) {
      return Response.json({ error: 'title is required' }, { status: 400 });
    }

    const mimeType = mimeFromName(file.name);
    const docId = uuidv4();
    const filePath = `${docId}/${file.name}`;

    // Upload to Supabase Storage
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: storageError } = await supabase.storage
      .from('docs')
      .upload(filePath, buffer, { contentType: mimeType, upsert: false });

    if (storageError) {
      throw new Error(`Storage upload failed: ${storageError.message}`);
    }

    // Insert document record
    const { error: dbError } = await supabase.from('documents').insert({
      id: docId,
      title,
      source_url: sourceUrl,
      mime_type: mimeType,
      file_path: filePath,
      status: 'pending',
    });

    if (dbError) {
      // Rollback storage on DB failure
      await supabase.storage.from('docs').remove([filePath]);
      throw new Error(`Database insert failed: ${dbError.message}`);
    }

    return Response.json({ success: true, documentId: docId });
  } catch (err) {
    console.error('Upload error:', err);
    const msg = err instanceof Error ? err.message : 'Upload failed';
    return Response.json({ error: msg }, { status: 500 });
  }
}
