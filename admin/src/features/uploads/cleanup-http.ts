import { timingSafeEqual } from 'node:crypto';

import { logger } from '../../server/observability/logger';
import type { CleanupCounters } from './cleanup-worker';

export type CleanupHandlerDependencies = Readonly<{
  secrets(): Readonly<{ workerSecret: string | null; cronSecret: string | null }>;
  run(): Promise<CleanupCounters>;
  sweep(): Promise<Readonly<{ scanned: number; enqueued: number }>>;
}>;

type AuthorizationResult = 'ok' | 'missing_secret' | 'unauthorized';

const COUNTER_KEYS = [
  'claimed',
  'completed',
  'skippedReferenced',
  'skippedOwnership',
  'quarantined',
  'failed',
  'leaseLost',
  'released',
] as const;

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function tokenMatches(token: string, secret: string): boolean {
  const provided = Buffer.from(token, 'utf8');
  const expected = Buffer.from(secret, 'utf8');

  // timingSafeEqual throws on length mismatch, so compare lengths first. The
  // length itself is not a secret worth hiding here.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export function authorizeCleanupRequest(
  request: Request,
  secrets: Readonly<{ workerSecret: string | null; cronSecret: string | null }>,
): AuthorizationResult {
  const { workerSecret, cronSecret } = secrets;
  if (!workerSecret && !cronSecret) return 'missing_secret';

  const token = bearerToken(request);
  if (!token) return 'unauthorized';

  const matches =
    (workerSecret !== null && tokenMatches(token, workerSecret)) ||
    (cronSecret !== null && tokenMatches(token, cronSecret));

  return matches ? 'ok' : 'unauthorized';
}

function noStore(status: number, body?: unknown): Response {
  const headers = new Headers({ 'cache-control': 'no-store' });

  if (body === undefined) return new Response(null, { status, headers });

  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

function counterPayload(counters: CleanupCounters): Record<string, number> {
  const payload: Record<string, number> = {};
  for (const key of COUNTER_KEYS) {
    payload[key] = counters[key];
  }
  return payload;
}

function reject(result: AuthorizationResult): Response | null {
  if (result === 'missing_secret') return noStore(503);
  if (result === 'unauthorized') return noStore(401);
  return null;
}

export async function handleCleanupRun(
  request: Request,
  dependencies: CleanupHandlerDependencies,
): Promise<Response> {
  const rejected = reject(authorizeCleanupRequest(request, dependencies.secrets()));
  if (rejected) return rejected;

  try {
    const counters = await dependencies.run();
    return noStore(200, { ok: true, ...counterPayload(counters) });
  } catch (error) {
    // The response carries no error detail; the log carries only the class.
    logger.error({
      correlationId: crypto.randomUUID(),
      operation: 'cleanup.run',
      error,
    });
    return noStore(500, { ok: false });
  }
}

export async function handleCleanupSweep(
  request: Request,
  dependencies: CleanupHandlerDependencies,
): Promise<Response> {
  const rejected = reject(authorizeCleanupRequest(request, dependencies.secrets()));
  if (rejected) return rejected;

  try {
    const result = await dependencies.sweep();
    return noStore(200, { ok: true, scanned: result.scanned, enqueued: result.enqueued });
  } catch (error) {
    logger.error({
      correlationId: crypto.randomUUID(),
      operation: 'cleanup.sweep',
      error,
    });
    return noStore(500, { ok: false });
  }
}
