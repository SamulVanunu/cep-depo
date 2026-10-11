import { describe, expect, it, vi } from 'vitest';

import { closeReport, type ReportActionDependencies } from './report-actions';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const reportId = 'a2000000-0000-4000-8000-000000000001';

function dependencies(overrides: Partial<ReportActionDependencies> = {}): ReportActionDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    getStatus: vi.fn(async () => 'open' as const),
    closeRpc: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe('report moderation', () => {
  it.each(['', '   ', 'x'.repeat(2001)])('rejects an invalid admin note: %j', async note => {
    const closeRpc = vi.fn();
    const result = await closeReport(
      { reportId, status: 'resolved', adminNote: note },
      dependencies({ closeRpc }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(closeRpc).not.toHaveBeenCalled();
  });

  it('rejects an invalid report UUID before mutation', async () => {
    const closeRpc = vi.fn();
    const result = await closeReport(
      { reportId: 'bad-id', status: 'resolved', adminNote: 'Çözüldü.' },
      dependencies({ closeRpc }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(closeRpc).not.toHaveBeenCalled();
  });

  it('rejects a closed-report conflict', async () => {
    const closeRpc = vi.fn();
    const result = await closeReport(
      { reportId, status: 'dismissed', adminNote: 'Geçersiz şikâyet.' },
      dependencies({ getStatus: vi.fn(async () => 'resolved' as const), closeRpc }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(closeRpc).not.toHaveBeenCalled();
  });

  it('closes an open report exactly once with trimmed note and audit data', async () => {
    const closeRpc = vi.fn(async () => ({ error: null }));
    const result = await closeReport(
      { reportId, status: 'resolved', adminNote: '  Bağlantı yenilendi.  ' },
      dependencies({ closeRpc }),
    );
    expect(result).toEqual({ ok: true, data: null });
    expect(closeRpc).toHaveBeenCalledOnce();
    expect(closeRpc).toHaveBeenCalledWith(actorId, reportId, 'resolved', 'Bağlantı yenilendi.');
  });
});
