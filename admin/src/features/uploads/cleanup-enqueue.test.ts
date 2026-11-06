import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database.types';
import type { CleanupAsset } from './asset-cleanup';
import { enqueueCleanupAndAudit } from './cleanup-enqueue';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const auditId = 'b2000000-0000-4000-8000-000000000001';

const asset: CleanupAsset = {
  bucket: 'apks',
  path: 'apps/a2000000-0000-4000-8000-000000000001/versions/a3000000-0000-4000-8000-000000000001.apk',
  assetId: 'a3000000-0000-4000-8000-000000000001',
  targetType: 'apk',
};

type RpcResult = Readonly<{ data: unknown; error: unknown }>;

function auditRow(created: boolean, id: string = auditId) {
  return { data: [{ id, created }], error: null };
}

function fakeClient(options: Readonly<{
  enqueue?: RpcResult | readonly RpcResult[];
  audit?: RpcResult | readonly RpcResult[];
}> = {}) {
  const enqueueResults: RpcResult[] = options.enqueue === undefined
    ? [{ data: 'b1000000-0000-4000-8000-000000000001', error: null }]
    : Array.isArray(options.enqueue)
      ? [...(options.enqueue as RpcResult[])]
      : [options.enqueue as RpcResult];
  const auditResults: RpcResult[] = options.audit === undefined
    ? [auditRow(true)]
    : Array.isArray(options.audit)
      ? [...(options.audit as RpcResult[])]
      : [options.audit as RpcResult];
  let enqueueCalls = 0;
  let auditCalls = 0;
  const writtenRows: { id: string }[] = [];

  const rpc = vi.fn(async (name: string) => {
    if (name === 'cleanup_enqueue_orphan') {
      const result = enqueueResults[Math.min(enqueueCalls, enqueueResults.length - 1)]!;
      enqueueCalls += 1;
      return result;
    }
    if (name === 'admin_ensure_cleanup_audit') {
      const result = auditResults[Math.min(auditCalls, auditResults.length - 1)]!;
      auditCalls += 1;
      if (!result.error && Array.isArray(result.data)) {
        for (const row of result.data as { id: string; created: boolean }[]) {
          if (row.created) writtenRows.push({ id: row.id });
        }
      }
      return result;
    }
    throw new Error(`unexpected rpc ${name}`);
  });

  const from = vi.fn();
  const remove = vi.fn();
  const client = {
    rpc,
    from,
    storage: { from: vi.fn(() => ({ remove })) },
  } as unknown as SupabaseClient<Database>;

  return { client, rpc, from, remove, writtenRows };
}

function rpcNames(rpc: ReturnType<typeof vi.fn>): string[] {
  return rpc.mock.calls.map(call => call[0] as string);
}

describe('enqueueCleanupAndAudit', () => {
  it('creates one tombstone and records the cleanup audit for a new job', async () => {
    const subject = fakeClient();

    await expect(enqueueCleanupAndAudit(subject.client, {
      actorId,
      asset,
      auditAction: 'asset.cleanup_pending',
    })).resolves.toEqual({
      queued: true,
      deduped: false,
      audit: 'recorded',
      enqueueError: null,
      auditError: null,
    });

    expect(subject.rpc).toHaveBeenNthCalledWith(1, 'cleanup_enqueue_orphan', {
      p_bucket: 'apks',
      p_path: asset.path,
      p_target_type: 'apk',
    });
    expect(subject.rpc).toHaveBeenNthCalledWith(2, 'admin_ensure_cleanup_audit', {
      p_actor_id: actorId,
      p_action: 'asset.cleanup_pending',
      p_target_type: 'asset',
      p_target_id: asset.assetId,
      p_metadata: {
        bucket: 'apks',
        path: asset.path,
        operation_id: asset.assetId,
      },
    });
    expect(subject.from).not.toHaveBeenCalled();
    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('does not attempt the audit when the enqueue fails', async () => {
    const subject = fakeClient({
      enqueue: { data: null, error: { code: '42501', status: 403 } },
    });

    await expect(enqueueCleanupAndAudit(subject.client, {
      actorId,
      asset,
      auditAction: 'asset.cleanup_pending',
    })).resolves.toEqual({
      queued: false,
      deduped: false,
      audit: 'not_attempted',
      enqueueError: { code: '42501', status: 403 },
      auditError: null,
    });

    expect(rpcNames(subject.rpc)).toEqual(['cleanup_enqueue_orphan']);
    expect(subject.from).not.toHaveBeenCalled();
    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('keeps the job queued when the audit write fails after the tombstone exists', async () => {
    const subject = fakeClient({ audit: { data: null, error: { code: 'P0001' } } });

    await expect(enqueueCleanupAndAudit(subject.client, {
      actorId,
      asset,
      auditAction: 'asset.cleanup_pending',
    })).resolves.toEqual({
      queued: true,
      deduped: false,
      audit: 'failed',
      enqueueError: null,
      auditError: { code: 'P0001' },
    });

    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('reports an existing audit row as already recorded', async () => {
    const subject = fakeClient({
      enqueue: { data: null, error: null },
      audit: auditRow(false),
    });

    await expect(enqueueCleanupAndAudit(subject.client, {
      actorId,
      asset,
      auditAction: 'asset.cleanup_pending',
    })).resolves.toEqual({
      queued: true,
      deduped: true,
      audit: 'already_recorded',
      enqueueError: null,
      auditError: null,
    });

    expect(rpcNames(subject.rpc)).toEqual([
      'cleanup_enqueue_orphan',
      'admin_ensure_cleanup_audit',
    ]);
    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('repairs a missing audit row on a deduplicated enqueue', async () => {
    const subject = fakeClient({
      enqueue: { data: null, error: null },
      audit: auditRow(true),
    });

    await expect(enqueueCleanupAndAudit(subject.client, {
      actorId,
      asset,
      auditAction: 'asset.cleanup_pending',
    })).resolves.toEqual({
      queued: true,
      deduped: true,
      audit: 'recorded',
      enqueueError: null,
      auditError: null,
    });

    expect(rpcNames(subject.rpc)).toEqual([
      'cleanup_enqueue_orphan',
      'admin_ensure_cleanup_audit',
    ]);
  });

  it('keeps the job queued when the dedupe audit repair fails', async () => {
    const subject = fakeClient({
      enqueue: { data: null, error: null },
      audit: { data: null, error: { code: 'P0001' } },
    });

    await expect(enqueueCleanupAndAudit(subject.client, {
      actorId,
      asset,
      auditAction: 'asset.cleanup_pending',
    })).resolves.toEqual({
      queued: true,
      deduped: true,
      audit: 'failed',
      enqueueError: null,
      auditError: { code: 'P0001' },
    });

    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('treats an empty audit response as a contract failure', async () => {
    const subject = fakeClient({ audit: { data: [], error: null } });

    await expect(enqueueCleanupAndAudit(subject.client, {
      actorId,
      asset,
      auditAction: 'asset.cleanup_pending',
    })).resolves.toEqual({
      queued: true,
      deduped: false,
      audit: 'failed',
      enqueueError: null,
      auditError: { code: 'AUDIT_CONTRACT' },
    });

    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('treats an incomplete audit row as a contract failure', async () => {
    const subject = fakeClient({
      audit: { data: [{ id: null, created: true }], error: null },
    });

    await expect(enqueueCleanupAndAudit(subject.client, {
      actorId,
      asset,
      auditAction: 'asset.cleanup_pending',
    })).resolves.toEqual({
      queued: true,
      deduped: false,
      audit: 'failed',
      enqueueError: null,
      auditError: { code: 'AUDIT_CONTRACT' },
    });

    expect(subject.remove).not.toHaveBeenCalled();
  });

  it('completes the missing audit when the same path is retried', async () => {
    const subject = fakeClient({
      enqueue: [
        { data: 'b1000000-0000-4000-8000-000000000001', error: null },
        { data: null, error: null },
      ],
      audit: [
        { data: null, error: { code: 'P0001' } },
        auditRow(true),
      ],
    });
    const input = { actorId, asset, auditAction: 'asset.cleanup_pending' as const };

    await expect(enqueueCleanupAndAudit(subject.client, input)).resolves.toMatchObject({
      queued: true,
      deduped: false,
      audit: 'failed',
    });

    await expect(enqueueCleanupAndAudit(subject.client, input)).resolves.toEqual({
      queued: true,
      deduped: true,
      audit: 'recorded',
      enqueueError: null,
      auditError: null,
    });
    expect(subject.writtenRows).toHaveLength(1);
  });

  it('records the orphan upload audit against the draft path', async () => {
    const draft: CleanupAsset = {
      bucket: 'apk-drafts',
      path: 'operations/a4000000-0000-4000-8000-000000000001/source.apk',
      assetId: 'a4000000-0000-4000-8000-000000000001',
      targetType: 'apk_draft',
    };
    const subject = fakeClient();

    await expect(enqueueCleanupAndAudit(subject.client, {
      actorId,
      asset: draft,
      auditAction: 'upload.cleanup',
    })).resolves.toEqual({
      queued: true,
      deduped: false,
      audit: 'recorded',
      enqueueError: null,
      auditError: null,
    });

    expect(subject.rpc).toHaveBeenNthCalledWith(2, 'admin_ensure_cleanup_audit', {
      p_actor_id: actorId,
      p_action: 'upload.cleanup',
      p_target_type: 'upload',
      p_target_id: draft.path,
      p_metadata: {
        bucket: 'apk-drafts',
        path: draft.path,
        operation_id: draft.assetId,
      },
    });
    expect(subject.remove).not.toHaveBeenCalled();
  });
});
