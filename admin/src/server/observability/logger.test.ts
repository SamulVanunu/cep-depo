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
});
