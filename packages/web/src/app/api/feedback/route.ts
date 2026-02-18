import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, messageId, rating, category, comment } = body;

    if (!sessionId || !messageId || !rating) {
      return Response.json(
        { error: 'sessionId, messageId, and rating are required' },
        { status: 400, headers: CORS }
      );
    }

    if (!['up', 'down'].includes(rating)) {
      return Response.json({ error: 'rating must be "up" or "down"' }, { status: 400, headers: CORS });
    }

    const { error } = await supabase.from('chat_feedback').insert({
      id: uuidv4(),
      session_id: sessionId,
      message_id: messageId,
      rating,
      category: category ?? null,
      comment: comment ?? null,
    });

    if (error) {
      throw error;
    }

    return Response.json({ success: true }, { headers: CORS });
  } catch (err) {
    console.error('Feedback route error:', err);
    return Response.json({ error: 'Failed to save feedback' }, { status: 500, headers: CORS });
  }
}
