import { describe, expect, it, vi } from 'vitest';

import { createLogger } from './logger';

describe('structured logger', () => {
  it('preserves operational identifiers while redacting sensitive values', () => {
    const sink = vi.fn();
    const logger = createLogger(sink);
    logger.error({
      correlationId: 'd1000000-0000-4000-8000-000000000001',
      operation: 'version.publish',
      actorId: 'a1000000-0000-4000-8000-000000000001',
      targetId: 'a2000000-0000-4000-8000-000000000001',
      targetType: 'version',
      durationMs: 125,
      error: new TypeError('failed'),
      password: 'do-not-log',
      authorization: 'Bearer hidden-token',
      secretKey: 'sb_secret_hidden',
      commentBody: 'private comment',
      reportDescription: 'private report',
      apkBytes: new Uint8Array([0x50, 0x4b]),
    });

    expect(sink).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      correlationId: 'd1000000-0000-4000-8000-000000000001',
      operation: 'version.publish',
      actorId: 'a1000000-0000-4000-8000-000000000001',
      targetId: 'a2000000-0000-4000-8000-000000000001',
      targetType: 'version',
      durationMs: 125,
      errorClass: 'TypeError',
    }));
    const output = JSON.stringify(sink.mock.calls);
    for (const secret of ['do-not-log', 'hidden-token', 'sb_secret_hidden', 'private comment', 'private report', '80,75']) {
      expect(output).not.toContain(secret);
    }
  });

  it('keeps only allowlisted counters and a well-formed worker id', () => {
    const sink = vi.fn();
    const logger = createLogger(sink);
    logger.info({
      correlationId: 'd2000000-0000-4000-8000-000000000001',
      operation: 'cleanup.run',
      workerId: 'cleanup-local-a1b2c3d4',
      counters: {
        claimed: 3,
        completed: 2,
        failed: 0,
        skippedReferenced: 1,
        path: 1,
        jobId: 2,
        error: 3,
        dropped: 4,
        infinite: Number.POSITIVE_INFINITY,
      },
    });

    const record = sink.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(record.workerId).toBe('cleanup-local-a1b2c3d4');
    expect(record.counters).toEqual({
      claimed: 3,
      completed: 2,
      failed: 0,
      skippedReferenced: 1,
    });
    const output = JSON.stringify(record);
    for (const leaked of ['apps/', 'jobId', 'dropped', 'infinite']) {
      expect(output).not.toContain(leaked);
    }
  });

  it('drops a malformed worker id and an empty counter set', () => {
    const sink = vi.fn();
    const logger = createLogger(sink);
    logger.info({
      correlationId: 'd3000000-0000-4000-8000-000000000001',
      operation: 'cleanup.run',
      workerId: 'Not A Worker Id',
      counters: { mystery: 1 },
    });

    const record = sink.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(record).not.toHaveProperty('workerId');
    expect(record).not.toHaveProperty('counters');
    expect(record.operation).toBe('cleanup.run');
  });
});
