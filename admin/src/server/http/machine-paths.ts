/**
 * Routes that authenticate with their own bearer secret inside the handler
 * instead of a browser session. The proxy must not redirect them to /login.
 *
 * Kept as a pure predicate so the allowlist is unit-testable without booting
 * Next.js; an exact match prevents a path like /api/cleanup/run/extra or a
 * lookalike prefix from skipping the session check.
 */
const BEARER_AUTHENTICATED_PATHS: ReadonlySet<string> = new Set([
  '/api/cleanup/run',
  '/api/cleanup/sweep',
]);

export function isBearerAuthenticatedPath(pathname: string): boolean {
  return BEARER_AUTHENTICATED_PATHS.has(pathname);
}
