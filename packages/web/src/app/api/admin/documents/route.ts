import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const { data, error } = await supabase
    .from('documents')
    .select('id, title, source_url, mime_type, status, error_msg, ingested_at, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ documents: data });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400 });
  }

  // Get file path first
  const { data: doc } = await supabase
    .from('documents')
    .select('file_path')
    .eq('id', id)
    .single();

  if (doc?.file_path) {
    await supabase.storage.from('docs').remove([doc.file_path]);
  }

  const { error } = await supabase.from('documents').delete().eq('id', id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
