import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 100);

  if (!sessionId) {
    return Response.json({ messages: [] }, { headers: CORS });
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, sources, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    return Response.json({ messages: [] }, { headers: CORS });
  }

  return Response.json({ messages: data ?? [] }, { headers: CORS });
}
