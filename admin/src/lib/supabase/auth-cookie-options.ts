type AuthCookieOptions = Readonly<{
  path: string;
  sameSite: 'lax';
  httpOnly: true;
  secure: boolean;
  maxAge: number;
}>;

/**
 * The Supabase SSR library defaults to a 400 day, JS-readable cookie. Admin
 * sessions are refreshed by `proxy.ts` on every access-token renewal, so this
 * window only bounds inactivity: an active admin never reaches it.
 */
const SESSION_INACTIVITY_SECONDS = 30 * 24 * 60 * 60;

export function authCookieOptions(): AuthCookieOptions {
  return {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    maxAge: SESSION_INACTIVITY_SECONDS,
  };
}
