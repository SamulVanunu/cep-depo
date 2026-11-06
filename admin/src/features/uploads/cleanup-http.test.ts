import { describe, expect, it, vi } from 'vitest';

import {
  authorizeCleanupRequest,
  handleCleanupRun,
  handleCleanupSweep,
  type CleanupHandlerDependencies,
} from './cleanup-http';
import type { CleanupCounters } from './cleanup-worker';

const WORKER_SECRET = 'w'.repeat(32);
const CRON_SECRET = 'c'.repeat(32);

const counters: CleanupCounters = {
  claimed: 3,
  completed: 2,
  skippedReferenced: 1,
  skippedOwnership: 0,
  quarantined: 0,
  failed: 0,
  leaseLost: 0,
  released: 0,
};

function dependencies(
  overrides: Partial<CleanupHandlerDependencies> = {},
): CleanupHandlerDependencies {
  return {
    secrets: () => ({ workerSecret: WORKER_SECRET, cronSecret: CRON_SECRET }),
    run: vi.fn(async () => counters),
    sweep: vi.fn(async () => ({ scanned: 7, enqueued: 2 })),
    ...overrides,
  };
}

function request(authorization?: string) {
  return new Request('https://admin.example.test/api/cleanup/run', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  });
}

describe('authorizeCleanupRequest', () => {
  it('reports missing_secret when nothing is configured', () => {
    const secrets = { workerSecret: null, cronSecret: null };

    expect(authorizeCleanupRequest(request('Bearer anything'), secrets)).toBe(
      'missing_secret',
    );
  });

  it('accepts either configured secret', () => {
    const secrets = { workerSecret: WORKER_SECRET, cronSecret: CRON_SECRET };

    expect(authorizeCleanupRequest(request(`Bearer ${WORKER_SECRET}`), secrets)).toBe('ok');
    expect(authorizeCleanupRequest(request(`Bearer ${CRON_SECRET}`), secrets)).toBe('ok');
  });

  it('rejects a missing header and a wrong token', () => {
    const secrets = { workerSecret: WORKER_SECRET, cronSecret: null };

    expect(authorizeCleanupRequest(request(), secrets)).toBe('unauthorized');
    expect(authorizeCleanupRequest(request('Bearer nope'), secrets)).toBe('unauthorized');
    expect(authorizeCleanupRequest(request(WORKER_SECRET), secrets)).toBe('unauthorized');
  });

  it('rejects a token of a different length without throwing', () => {
    const secrets = { workerSecret: WORKER_SECRET, cronSecret: null };

    expect(() =>
      authorizeCleanupRequest(request('Bearer short'), secrets),
    ).not.toThrow();
    expect(authorizeCleanupRequest(request('Bearer short'), secrets)).toBe('unauthorized');
  });
});

describe('handleCleanupRun', () => {
  it('returns 503 and runs nothing when no secret is configured', async () => {
    const subject = dependencies({ secrets: () => ({ workerSecret: null, cronSecret: null }) });

    const response = await handleCleanupRun(request(`Bearer ${WORKER_SECRET}`), subject);

    expect(response.status).toBe(503);
    expect(subject.run).not.toHaveBeenCalled();
  });

  it('returns 401 without an authorization header', async () => {
    const subject = dependencies();

    const response = await handleCleanupRun(request(), subject);

    expect(response.status).toBe(401);
    expect(subject.run).not.toHaveBeenCalled();
  });

  it('returns 401 for a wrong token', async () => {
    const subject = dependencies();

    const response = await handleCleanupRun(request(`Bearer ${'x'.repeat(32)}`), subject);

    expect(response.status).toBe(401);
    expect(subject.run).not.toHaveBeenCalled();
  });

  it('accepts the worker secret and returns the counters', async () => {
    const subject = dependencies();

    const response = await handleCleanupRun(request(`Bearer ${WORKER_SECRET}`), subject);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, ...counters });
  });

  it('accepts the cron secret', async () => {
    const subject = dependencies();

    const response = await handleCleanupRun(request(`Bearer ${CRON_SECRET}`), subject);

    expect(response.status).toBe(200);
    expect(subject.run).toHaveBeenCalledTimes(1);
  });

  it('returns counters only, with no-store', async () => {
    const subject = dependencies();
    const response = await handleCleanupRun(request(`Bearer ${WORKER_SECRET}`), subject);

    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(
      [
        'claimed',
        'completed',
        'failed',
        'leaseLost',
        'ok',
        'quarantined',
        'released',
        'skippedOwnership',
        'skippedReferenced',
      ].sort(),
    );
    const serialized = JSON.stringify(body);
    for (const leaked of ['path', 'jobId', 'error', 'workerId']) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('returns 500 without leaking the error when the batch throws', async () => {
    const subject = dependencies({
      run: vi.fn(async () => {
        throw new Error('database password rotation failed at 10.0.0.4');
      }),
    });

    const response = await handleCleanupRun(request(`Bearer ${WORKER_SECRET}`), subject);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ ok: false });
    expect(JSON.stringify(body)).not.toContain('10.0.0.4');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('handleCleanupSweep', () => {
  it('applies the same authorization rules', async () => {
    const subject = dependencies();

    expect((await handleCleanupSweep(request(), subject)).status).toBe(401);
    expect(subject.sweep).not.toHaveBeenCalled();

    expect((await handleCleanupSweep(request(`Bearer ${WORKER_SECRET}`), subject)).status).toBe(
      200,
    );
    expect(subject.sweep).toHaveBeenCalledTimes(1);
  });

  it('returns the sweep counters', async () => {
    const subject = dependencies();

    const response = await handleCleanupSweep(request(`Bearer ${CRON_SECRET}`), subject);

    await expect(response.json()).resolves.toEqual({ ok: true, scanned: 7, enqueued: 2 });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 503 when no secret is configured', async () => {
    const subject = dependencies({ secrets: () => ({ workerSecret: null, cronSecret: null }) });

    const response = await handleCleanupSweep(request(`Bearer ${CRON_SECRET}`), subject);

    expect(response.status).toBe(503);
    expect(subject.sweep).not.toHaveBeenCalled();
  });
});
