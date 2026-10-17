import { describe, expect, it, vi } from 'vitest';

import {
  archiveApp,
  createApp,
  createCategory,
  createPublishingApp,
  createQuickApp,
  deleteAppPermanently,
  setAppPublicationStatus,
  updateApp,
  updateCategory,
  type CatalogActionDependencies,
  type LifecycleActionDependencies,
  type PublishingAppActionDependencies,
} from './app-actions';
import {
  cleanupPublishingAsset,
  createAssetUploadIntent,
  type AssetActionDependencies,
  type PublishingAssetCleanupDependencies,
} from './asset-actions';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const appId = 'a2000000-0000-4000-8000-000000000001';
const categoryId = 'a3000000-0000-4000-8000-000000000001';
const versionId = 'a4000000-0000-4000-8000-000000000001';
const operationId = 'a5000000-0000-4000-8000-000000000001';

function appForm(selectedCategoryId: string | null = categoryId): FormData {
  const data = new FormData();
  data.set('categoryId', selectedCategoryId ?? '');
  data.set('slug', 'ornek-uygulama');
  data.set('title', 'Örnek Uygulama');
  data.set('shortDescription', 'Yeterince uzun kısa açıklama');
  data.set('description', 'Yeterince uzun ayrıntılı uygulama açıklaması.');
  data.set('featured', 'on');
  data.set('status', 'active');
  return data;
}

function lifecycleDependencies(
  overrides: Partial<LifecycleActionDependencies> = {},
): LifecycleActionDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    setStatusRpc: vi.fn(async () => ({ error: null })),
    deleteRpc: vi.fn(async () => ({ data: [], error: null })),
    cleanupAssets: vi.fn(async () => ({ pending: 0 })),
    ...overrides,
  };
}

function catalogDependencies(
  overrides: Partial<CatalogActionDependencies> = {},
): CatalogActionDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    categoryExists: vi.fn(async () => true),
    categoryIsDefault: vi.fn(async () => false),
    getDefaultCategoryId: vi.fn(async () => categoryId),
    insertApp: vi.fn(async () => ({ data: { id: appId }, error: null })),
    updateApp: vi.fn(async () => ({ error: null })),
    insertCategory: vi.fn(async () => ({ data: { id: categoryId }, error: null })),
    updateCategory: vi.fn(async () => ({ error: null })),
    recordAudit: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

function publishingDependencies(
  overrides: Partial<PublishingAppActionDependencies> = {},
): PublishingAppActionDependencies {
  return {
    authorize: vi.fn(async () => ({ userId: actorId })),
    categoryIsActive: vi.fn(async () => true),
    insertApp: vi.fn(async () => ({ data: { id: appId }, error: null })),
    recordAudit: vi.fn(async () => ({ error: null })),
    createOperationId: () => operationId,
    ...overrides,
  };
}

const publishingInput = {
  title: 'Yeni Uygulama',
  slug: '  Yeni Uygulama  ',
  categoryId,
  shortDescription: 'Yeni uygulama için yeterli kısa açıklama.',
  description: 'Yeni uygulama için yeterli ayrıntılı açıklama metni.',
  featured: true,
};

describe('catalog actions', () => {
  it('creates a complete publishing app archived and owned by a new operation', async () => {
    const insertApp = vi.fn(async () => ({ data: { id: appId }, error: null }));

    const result = await createPublishingApp(
      publishingInput,
      publishingDependencies({ insertApp }),
    );

    expect(result).toEqual({
      ok: true,
      data: { id: appId, slug: 'yeni-uygulama', status: 'archived', operationId },
    });
    expect(insertApp).toHaveBeenCalledWith({
      category_id: categoryId,
      slug: 'yeni-uygulama',
      title: 'Yeni Uygulama',
      short_description: publishingInput.shortDescription,
      description: publishingInput.description,
      featured: true,
      status: 'archived',
    });
  });

  it('rejects an inactive publishing category server-side before staging an app', async () => {
    const insertApp = vi.fn();

    const result = await createPublishingApp(
      publishingInput,
      publishingDependencies({
        categoryIsActive: vi.fn(async () => false),
        insertApp,
      }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(insertApp).not.toHaveBeenCalled();
  });

  it('authorizes before creating an app and records only safe audit metadata', async () => {
    const order: string[] = [];
    const recordAudit = vi.fn(async () => ({ error: null }));
    const result = await createApp(
      appForm(),
      catalogDependencies({
        authorize: vi.fn(async () => {
          order.push('authorize');
          return { userId: actorId };
        }),
        insertApp: vi.fn(async () => {
          order.push('insert');
          return { data: { id: appId }, error: null };
        }),
        recordAudit,
      }),
    );

    expect(result).toMatchObject({ ok: true, data: { id: appId } });
    expect(order).toEqual(['authorize', 'insert']);
    expect(recordAudit).toHaveBeenCalledWith({
      actorId,
      action: 'app.create',
      targetType: 'app',
      targetId: appId,
      metadata: { status: 'archived' },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain('ayrıntılı');
  });

  it('creates an incomplete app archived even when form data requests activation', async () => {
    const insertApp = vi.fn(async () => ({ data: { id: appId }, error: null }));

    await createApp(appForm(), catalogDependencies({ insertApp }));

    expect(insertApp).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }));
  });

  it('updates metadata without allowing a status transition', async () => {
    const updateAppMutation = vi.fn(async (
      updatedAppId: string,
      input: Readonly<Record<string, unknown>>,
    ) => {
      void updatedAppId;
      void input;
      return { error: null };
    });

    await updateApp(appId, appForm(), catalogDependencies({ updateApp: updateAppMutation }));

    expect(updateAppMutation).toHaveBeenCalledOnce();
    expect(updateAppMutation.mock.calls[0]?.[1]).not.toHaveProperty('status');
  });

  it('fails an invalid category before mutation', async () => {
    const insertApp = vi.fn();
    const result = await createApp(
      appForm(),
      catalogDependencies({ categoryExists: vi.fn(async () => false), insertApp }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(insertApp).not.toHaveBeenCalled();
  });

  it('uses the default category when the full form leaves category empty', async () => {
    const getDefaultCategoryId = vi.fn(async () => categoryId);
    const insertApp = vi.fn(async () => ({ data: { id: appId }, error: null }));

    const result = await createApp(
      appForm(null),
      catalogDependencies({ getDefaultCategoryId, insertApp }),
    );

    expect(result).toMatchObject({ ok: true, data: { id: appId } });
    expect(getDefaultCategoryId).toHaveBeenCalledOnce();
    expect(insertApp).toHaveBeenCalledWith(expect.objectContaining({ category_id: categoryId }));
  });

  it('preserves an explicit valid category without reading the default', async () => {
    const getDefaultCategoryId = vi.fn();
    const insertApp = vi.fn(async () => ({ data: { id: appId }, error: null }));

    const result = await createApp(
      appForm(categoryId),
      catalogDependencies({ getDefaultCategoryId, insertApp }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(getDefaultCategoryId).not.toHaveBeenCalled();
    expect(insertApp).toHaveBeenCalledWith(expect.objectContaining({ category_id: categoryId }));
  });

  it('fails safely when no default category exists', async () => {
    const insertApp = vi.fn();

    const result = await createApp(
      appForm(null),
      catalogDependencies({ getDefaultCategoryId: vi.fn(async () => null), insertApp }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(insertApp).not.toHaveBeenCalled();
  });

  it('creates a quick app as archived with only server-owned defaults', async () => {
    const insertApp = vi.fn(async () => ({ data: { id: appId }, error: null }));
    const recordAudit = vi.fn(async () => ({ error: null }));

    const result = await createQuickApp(
      {
        title: 'Çağrı Öz',
        shortDescription: 'Yeni uygulama için yeterli kısa açıklama.',
        categoryId,
        featured: true,
        status: 'active',
      },
      catalogDependencies({ insertApp, recordAudit }),
    );

    expect(result).toEqual({
      ok: true,
      data: { id: appId, slug: 'cagri-oz', status: 'archived' },
    });
    expect(insertApp).toHaveBeenCalledWith({
      category_id: categoryId,
      slug: 'cagri-oz',
      title: 'Çağrı Öz',
      short_description: 'Yeni uygulama için yeterli kısa açıklama.',
      description: 'Yeni uygulama için yeterli kısa açıklama.',
      featured: false,
      status: 'archived',
    });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'app.create',
      metadata: { status: 'archived' },
    }));
  });

  it('maps duplicate quick app submission to one success and one safe conflict', async () => {
    const insertApp = vi.fn()
      .mockResolvedValueOnce({ data: { id: appId }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '23505' } });
    const recordAudit = vi.fn(async () => ({ error: null }));
    const dependencies = catalogDependencies({ insertApp, recordAudit });
    const input = {
      title: 'Tek Uygulama',
      shortDescription: 'Tekrarlı gönderimi engelleyen açıklama.',
    };

    await expect(createQuickApp(input, dependencies)).resolves.toMatchObject({ ok: true });
    await expect(createQuickApp(input, dependencies)).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it('maps a unique category slug conflict safely', async () => {
    const data = new FormData();
    data.set('name', 'Araçlar');
    data.set('slug', 'araclar');
    data.set('position', '0');
    data.set('isActive', 'on');

    const result = await createCategory(
      data,
      catalogDependencies({
        insertCategory: vi.fn(async () => ({ data: null, error: { code: '23505' } })),
      }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('rejects deactivating the default category before mutation', async () => {
    const data = new FormData();
    data.set('name', 'Genel');
    data.set('slug', 'genel');
    data.set('position', '0');
    const update = vi.fn();

    const result = await updateCategory(categoryId, data, catalogDependencies({
      categoryIsDefault: vi.fn(async () => true),
      updateCategory: update,
    }));

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(update).not.toHaveBeenCalled();
  });

  it('routes the legacy archive helper through the lifecycle RPC', async () => {
    const setStatusRpc = vi.fn(async () => ({ error: null }));
    const result = await archiveApp(appId, lifecycleDependencies({ setStatusRpc }));

    expect(result).toMatchObject({ ok: true });
    expect(setStatusRpc).toHaveBeenCalledWith(actorId, appId, 'archived');
  });
});

describe('asset upload intents', () => {
  it('authorizes first, validates image MIME/10 MiB and generates a server-owned path', async () => {
    const createSignedUpload = vi.fn(async (path: string) => ({
      data: { path, token: 'signed-token' },
      error: null,
    }));
    const dependencies: AssetActionDependencies = {
      authorize: vi.fn(async () => ({ userId: actorId })),
      appExists: vi.fn(async () => true),
      createId: () => 'a4000000-0000-4000-8000-000000000001',
      createSignedUpload,
    };

    await expect(
      createAssetUploadIntent(
        { appId, kind: 'icon', fileName: '../../chosen-name.png', mimeType: 'image/png', size: 1024 },
        dependencies,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        bucket: 'app-assets',
        path: `apps/${appId}/icons/a4000000-0000-4000-8000-000000000001.png`,
      },
    });
    expect(createSignedUpload).toHaveBeenCalledWith(
      `apps/${appId}/icons/a4000000-0000-4000-8000-000000000001.png`,
    );

    await expect(
      createAssetUploadIntent(
        { appId, kind: 'screenshot', fileName: 'bad.svg', mimeType: 'image/svg+xml', size: 1024 },
        dependencies,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    await expect(
      createAssetUploadIntent(
        { appId, kind: 'screenshot', fileName: 'large.webp', mimeType: 'image/webp', size: 10485761 },
        dependencies,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('cleans only a canonical app asset under the supplied publishing operation', async () => {
    const cleanupAssets = vi.fn(async () => ({ pending: 0 }));
    const dependencies: PublishingAssetCleanupDependencies = {
      authorize: vi.fn(async () => ({ userId: actorId })),
      cleanupAssets,
    };
    const path = `apps/${appId}/screenshots/${versionId}.webp`;

    await expect(cleanupPublishingAsset({
      appId,
      operationId,
      path,
      kind: 'screenshot',
    }, dependencies)).resolves.toEqual({ ok: true, data: { cleanupPending: false } });
    expect(cleanupAssets).toHaveBeenCalledWith([{
      bucket: 'app-assets',
      path,
      operationId,
      targetType: 'screenshot',
    }]);
  });

  it('rejects an unrelated publishing asset before Storage cleanup', async () => {
    const cleanupAssets = vi.fn();
    const dependencies: PublishingAssetCleanupDependencies = {
      authorize: vi.fn(async () => ({ userId: actorId })),
      cleanupAssets,
    };

    const result = await cleanupPublishingAsset({
      appId,
      operationId,
      path: `apps/a9000000-0000-4000-8000-000000000001/icons/${versionId}.png`,
      kind: 'icon',
    }, dependencies);

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(cleanupAssets).not.toHaveBeenCalled();
  });
});

describe('app lifecycle actions', () => {
  it('authorizes before changing publication status through the lifecycle RPC', async () => {
    const order: string[] = [];
    const setStatusRpc = vi.fn(async () => {
      order.push('rpc');
      return { error: null };
    });

    const result = await setAppPublicationStatus(appId, 'archived', lifecycleDependencies({
      authorize: vi.fn(async () => {
        order.push('authorize');
        return { userId: actorId };
      }),
      setStatusRpc,
    }));

    expect(result).toEqual({ ok: true, data: { id: appId, status: 'archived' } });
    expect(order).toEqual(['authorize', 'rpc']);
    expect(setStatusRpc).toHaveBeenCalledWith(actorId, appId, 'archived');
  });

  it('returns a safe action error without leaking an RPC failure', async () => {
    const result = await setAppPublicationStatus(appId, 'active', lifecycleDependencies({
      setStatusRpc: vi.fn(async () => ({
        error: { message: 'database connection secret https://internal.example.test' },
      })),
    }));

    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(JSON.stringify(result)).not.toContain('internal.example.test');
  });

  it('runs managed asset cleanup only after the delete transaction succeeds', async () => {
    const cleanupAssets = vi.fn(async () => ({ pending: 0 }));
    const deleteRpc = vi.fn(async () => ({
      data: [
        { bucket: 'app-assets', path: `apps/${appId}/icons/${versionId}.png` },
        { bucket: 'apks', path: `apps/${appId}/versions/${versionId}.apk` },
      ],
      error: null,
    }));

    const result = await deleteAppPermanently(
      appId,
      'Örnek Uygulama',
      lifecycleDependencies({ deleteRpc, cleanupAssets }),
    );

    expect(result).toEqual({ ok: true, data: { deleted: true, cleanupPending: false } });
    expect(deleteRpc).toHaveBeenCalledWith(actorId, appId, 'Örnek Uygulama');
    expect(cleanupAssets).toHaveBeenCalledWith([
      { bucket: 'app-assets', path: `apps/${appId}/icons/${versionId}.png`, operationId: versionId, targetType: 'icon' },
      { bucket: 'apks', path: `apps/${appId}/versions/${versionId}.apk`, operationId: versionId, targetType: 'apk' },
    ]);
  });

  it('never cleans Storage when the database delete fails', async () => {
    const cleanupAssets = vi.fn();
    const result = await deleteAppPermanently(appId, 'Örnek Uygulama', lifecycleDependencies({
      deleteRpc: vi.fn(async () => ({ data: null, error: { status: 503 } })),
      cleanupAssets,
    }));

    expect(result).toMatchObject({ ok: false, error: { code: 'TEMPORARY' } });
    expect(cleanupAssets).not.toHaveBeenCalled();
  });

  it('reports cleanup pending as a successful deletion without exposing cleanup errors', async () => {
    const result = await deleteAppPermanently(appId, 'Örnek Uygulama', lifecycleDependencies({
      deleteRpc: vi.fn(async () => ({
        data: [{ bucket: 'apks', path: `apps/${appId}/versions/${versionId}.apk` }],
        error: null,
      })),
      cleanupAssets: vi.fn(async () => { throw new Error('raw storage failure'); }),
    }));

    expect(result).toEqual({ ok: true, data: { deleted: true, cleanupPending: true } });
    expect(JSON.stringify(result)).not.toContain('raw storage failure');
  });
});
