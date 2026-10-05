import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createReportRepository,
  ReportRepositoryError,
} from '../../../src/features/reports/report.repository';
import type { ReportTarget } from '../../../src/features/reports/report.types';
import type { Database } from '../../../src/types/database.types';

type ReportClient = SupabaseClient<Database>;

const appTarget: ReportTarget = {
  appId: 'app-1',
  appTitle: 'Örnek Uygulama',
  versionId: null,
  versionName: null,
};
const versionTarget: ReportTarget = {
  ...appTarget,
  versionId: 'version-1',
  versionName: '1.2.0',
};

const reportRow = {
  id: 'report-1',
  reporter_id: 'user-1',
  app_id: 'app-1',
  version_id: null,
  reason: 'link_bozuk' as const,
  description: null,
  status: 'open' as const,
  created_at: '2026-10-01T10:00:00Z',
};

function createClient() {
  const maybeSingle = jest.fn().mockResolvedValue({ data: reportRow, error: null });
  const single = jest.fn().mockResolvedValue({ data: reportRow, error: null });
  let eq: jest.Mock;
  let is: jest.Mock;
  let select: jest.Mock;
  eq = jest.fn(() => ({ eq, is, maybeSingle }));
  is = jest.fn(() => ({ maybeSingle }));
  select = jest.fn(() => ({ eq, single }));
  const insert = jest.fn(() => ({ select }));
  const from = jest.fn(() => ({ insert, select }));
  return { client: { from } as unknown as ReportClient, from, select, eq, is, maybeSingle, single, insert };
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('İşlemin hata vermesi bekleniyordu.');
}

describe('ReportRepository', () => {
  it('queries only the current reporter open app-only target', async () => {
    const mock = createClient();

    await createReportRepository(mock.client).getOpen(appTarget, 'user-1');

    expect(mock.eq).toHaveBeenCalledWith('reporter_id', 'user-1');
    expect(mock.eq).toHaveBeenCalledWith('app_id', 'app-1');
    expect(mock.eq).toHaveBeenCalledWith('status', 'open');
    expect(mock.is).toHaveBeenCalledWith('version_id', null);
  });

  it('queries the exact matching app/version target', async () => {
    const mock = createClient();

    await createReportRepository(mock.client).getOpen(versionTarget, 'user-1');

    expect(mock.eq).toHaveBeenCalledWith('app_id', 'app-1');
    expect(mock.eq).toHaveBeenCalledWith('version_id', 'version-1');
  });

  it('inserts only immutable identity target and user-editable draft fields', async () => {
    const mock = createClient();

    await createReportRepository(mock.client).submitReport(versionTarget, 'user-1', {
      reason: 'link_bozuk',
      description: '  Bağlantı 404 dönüyor.  ',
    });

    expect(mock.insert).toHaveBeenCalledWith({
      reporter_id: 'user-1',
      app_id: 'app-1',
      version_id: 'version-1',
      reason: 'link_bozuk',
      description: 'Bağlantı 404 dönüyor.',
    });
    expect(mock.insert).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: expect.anything(), admin_note: expect.anything() }),
    );
  });

  it('normalizes a blank app-only description to null', async () => {
    const mock = createClient();
    await createReportRepository(mock.client).submitReport(appTarget, 'user-1', {
      reason: 'diger',
      description: '\t\n ',
    });
    expect(mock.insert).toHaveBeenCalledWith(
      expect.objectContaining({ version_id: null, description: null }),
    );
  });

  it('maps duplicate-open constraints to an alreadyOpen error', async () => {
    const mock = createClient();
    mock.single.mockResolvedValue({ data: null, error: { code: '23505', message: 'secret index' } });

    const error = await rejectionOf(
      createReportRepository(mock.client).submitReport(appTarget, 'user-1', {
        reason: 'acilmiyor',
        description: '',
      }),
    );

    expect(error).toBeInstanceOf(ReportRepositoryError);
    expect(error).toMatchObject({ code: 'alreadyOpen', message: 'Bu hedef için açık bir şikâyetin zaten var.' });
    expect(error.message).not.toContain('index');
  });

  it('sanitizes unknown database failures', async () => {
    const mock = createClient();
    mock.maybeSingle.mockResolvedValue({ data: null, error: { message: 'reports policy secret' } });
    const error = await rejectionOf(createReportRepository(mock.client).getOpen(appTarget, 'user-1'));
    expect(error.message).toBe('Şikâyet işlemi tamamlanamadı. Lütfen tekrar deneyin.');
    expect(error.message).not.toContain('policy');
  });
});
