import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { cookies } from 'next/headers';

async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get('admin_token')?.value === process.env.ADMIN_PASSWORD;
}

/** GET /api/admin/settings — returns all settings as key→value map */
export async function GET() {
  if (!(await isAuthenticated())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data, error } = await supabase.from('settings').select('key, value');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const settings: Record<string, string> = {};
  for (const row of data ?? []) settings[row.key] = row.value;
  return Response.json({ settings });
}

/** PATCH /api/admin/settings — update one setting: { key, value } */
export async function PATCH(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { key, value } = await req.json();
  if (!key || value === undefined) {
    return Response.json({ error: 'key and value are required' }, { status: 400 });
  }
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
