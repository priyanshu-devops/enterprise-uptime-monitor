import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const config = {
  matcher: ['/((?!login|status|api|_next|favicon).*)'],
};

export function middleware(req: NextRequest) {
  // Check for our custom auth flag cookie
  const authFlag = req.cookies.get('uptime-auth-flag');

  if (!authFlag) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
