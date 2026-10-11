import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import { getPublicEnv } from './src/lib/env';
import { contentSecurityPolicy } from './src/server/http/content-security-policy';
import type { Database } from './src/types/database.types';

function applySecurityHeaders(response: NextResponse, nonce: string, policy: string): NextResponse {
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('x-nonce', nonce);
  return response;
}

export async function proxy(request: NextRequest) {
  const env = getPublicEnv();
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const policy = contentSecurityPolicy(nonce, env.supabaseUrl, process.env.NODE_ENV === 'development');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', policy);
  requestHeaders.set('x-nonce', nonce);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
        }
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isLogin = request.nextUrl.pathname === '/login';

  if (!data?.claims?.sub && !isLogin) {
    const redirect = NextResponse.redirect(new URL('/login', request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return applySecurityHeaders(redirect, nonce, policy);
  }

  return applySecurityHeaders(response, nonce, policy);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
