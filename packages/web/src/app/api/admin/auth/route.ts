import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (!process.env.ADMIN_PASSWORD) {
    return Response.json({ error: 'ADMIN_PASSWORD not configured' }, { status: 500 });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return Response.json({ error: 'Invalid password' }, { status: 401 });
  }

  const response = Response.json({ success: true });
  response.headers.set(
    'Set-Cookie',
    `admin_token=${process.env.ADMIN_PASSWORD}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
  );
  return response;
}

export async function DELETE() {
  const response = Response.json({ success: true });
  response.headers.set(
    'Set-Cookie',
    'admin_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'
  );
  return response;
}
