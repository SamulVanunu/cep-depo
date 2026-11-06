import { describe, expect, it, vi } from 'vitest';

const { requireAdmin, getAdminClient } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getAdminClient: vi.fn(),
}));

vi.mock('../../server/auth/require-admin', () => ({ requireAdmin }));
vi.mock('../../server/supabase/admin-client', () => ({ getAdminClient }));

import { cleanupOrphanUploadAction } from './orphan-cleanup';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const path = 'operations/a4000000-0000-4000-8000-000000000001/source.apk';

function fakeClient(options: Readonly<{
  references?: readonly unknown[];
  referenceError?: unknown;
  auditCreated?: boolean;
  enqueue?: { data: unknown; error: unknown };
  audit?: { data: unknown; error: unknown };
}> = {}) {
  const remove = vi.fn();
  const rpc = vi.fn(async (name: string) => {
    if (name === 'cleanup_enqueue_orphan') {
      return options.enqueue ?? { data: 'b1000000-0000-4000-8000-000000000001', error: null };
    }
    if (name === 'admin_ensure_cleanup_audit') {
      return options.audit ?? {
        data: [{
          id: 'b2000000-0000-4000-8000-000000000001',
          created: options.auditCreated ?? true,
        }],
        error: null,
      };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  let action: string | null = null;
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: string) => {
      if (column === 'action') action = value;
      return builder;
    }),
    contains: vi.fn(() => builder),
    limit: vi.fn(async () => {
      if (action === 'version.draft') {
        return {
          data: options.references ?? [],
          error: options.referenceError ?? null,
        };
      }
      return { data: [], error: null };
    }),
  };
  const client = {
    rpc,
    storage: { from: vi.fn(() => ({ remove })) },
    from: vi.fn(() => builder),
  };

  return { client, rpc, remove };
}

function rpcNames(rpc: ReturnType<typeof vi.fn>): string[] {
  return rpc.mock.calls.map(call => call[0] as string);
}

describe('cleanupOrphanUploadAction', () => {
  it('queues the orphan for the worker without deleting the object', async () => {
    const subject = fakeClient();
    requireAdmin.mockResolvedValue({ userId: actorId });
    getAdminClient.mockReturnValue(subject.client);

    await expect(cleanupOrphanUploadAction(path)).resolves.toEqual({
      ok: true,
      data: { deduped: false, auditPending: false },
    });

    expect(subject.rpc).toHaveBeenNthCalledWith(1, 'cleanup_enqueue_orphan', {
      p_bucket: 'apk-drafts',
      p_path: path,
      p_target_type: 'apk_draft',
    });
    expect(rpcNames(subject.rpc)).toEqual([
      'cleanup_enqueue_orphan',
      'admin_ensure_cleanup_audit',
    ]);
    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('keeps the queued orphan successful when the audit write fails', async () => {
    const subject = fakeClient({ audit: { data: null, error: { code: 'P0001' } } });
    requireAdmin.mockResolvedValue({ userId: actorId });
    getAdminClient.mockReturnValue(subject.client);

    await expect(cleanupOrphanUploadAction(path)).resolves.toEqual({
      ok: true,
      data: { deduped: false, auditPending: true },
    });

    expect(rpcNames(subject.rpc)).toEqual([
      'cleanup_enqueue_orphan',
      'admin_ensure_cleanup_audit',
    ]);
    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('reports an already recorded audit without writing a second row', async () => {
    const subject = fakeClient({
      enqueue: { data: null, error: null },
      auditCreated: false,
    });
    requireAdmin.mockResolvedValue({ userId: actorId });
    getAdminClient.mockReturnValue(subject.client);

    await expect(cleanupOrphanUploadAction(path)).resolves.toEqual({
      ok: true,
      data: { deduped: true, auditPending: false },
    });

    expect(rpcNames(subject.rpc)).toEqual([
      'cleanup_enqueue_orphan',
      'admin_ensure_cleanup_audit',
    ]);
    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('repairs a missing audit row when the orphan is already queued', async () => {
    const subject = fakeClient({ enqueue: { data: null, error: null } });
    requireAdmin.mockResolvedValue({ userId: actorId });
    getAdminClient.mockReturnValue(subject.client);

    await expect(cleanupOrphanUploadAction(path)).resolves.toEqual({
      ok: true,
      data: { deduped: true, auditPending: false },
    });

    expect(rpcNames(subject.rpc)).toEqual([
      'cleanup_enqueue_orphan',
      'admin_ensure_cleanup_audit',
    ]);
    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('keeps the repair failure visible without failing the queued orphan', async () => {
    const subject = fakeClient({
      enqueue: { data: null, error: null },
      audit: { data: null, error: { code: 'P0001' } },
    });
    requireAdmin.mockResolvedValue({ userId: actorId });
    getAdminClient.mockReturnValue(subject.client);

    await expect(cleanupOrphanUploadAction(path)).resolves.toEqual({
      ok: true,
      data: { deduped: true, auditPending: true },
    });

    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('fails the action when the queue rejects the orphan', async () => {
    const subject = fakeClient({
      enqueue: { data: null, error: { code: 'XX000', status: 503 } },
    });
    requireAdmin.mockResolvedValue({ userId: actorId });
    getAdminClient.mockReturnValue(subject.client);

    const result = await cleanupOrphanUploadAction(path);

    expect(result).toMatchObject({ ok: false, error: { code: 'TEMPORARY' } });
    expect(rpcNames(subject.rpc)).toEqual(['cleanup_enqueue_orphan']);
    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('refuses a draft path that a version draft still references', async () => {
    const subject = fakeClient({ references: [{ id: 'b3000000-0000-4000-8000-000000000001' }] });
    requireAdmin.mockResolvedValue({ userId: actorId });
    getAdminClient.mockReturnValue(subject.client);

    await expect(cleanupOrphanUploadAction(path)).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });

    expect(subject.rpc).not.toHaveBeenCalled();
    expect(subject.remove).not.toHaveBeenCalled();
  });

  it.each([
    '../unrelated.apk',
    'operations/not-a-uuid/source.apk',
    'apps/a2000000-0000-4000-8000-000000000001/versions/a3000000-0000-4000-8000-000000000001.apk',
  ])('rejects a non-orphan path %# before authorizing', async invalid => {
    requireAdmin.mockClear();
    getAdminClient.mockClear();

    await expect(cleanupOrphanUploadAction(invalid)).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(getAdminClient).not.toHaveBeenCalled();
  });
});
