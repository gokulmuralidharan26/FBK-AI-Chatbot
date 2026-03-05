import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let the login page and auth API through without checking
  if (pathname === '/admin/login' || pathname === '/api/admin/auth') {
    return NextResponse.next();
  }

  const adminToken = request.cookies.get('admin_token')?.value;
  const validToken = process.env.ADMIN_PASSWORD;

  // Protect /admin pages
  if (pathname.startsWith('/admin')) {
    if (!adminToken || adminToken !== validToken) {
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
  }

  // Protect /api/admin/* routes (return 401 instead of redirect)
  if (pathname.startsWith('/api/admin/')) {
    if (!adminToken || adminToken !== validToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
