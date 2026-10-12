import { describe, expect, it, vi } from 'vitest';

import {
  archiveApp,
  createApp,
  createCategory,
  createQuickApp,
  updateCategory,
  type CatalogActionDependencies,
} from './app-actions';
import {
  createAssetUploadIntent,
  type AssetActionDependencies,
} from './asset-actions';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const appId = 'a2000000-0000-4000-8000-000000000001';
const categoryId = 'a3000000-0000-4000-8000-000000000001';

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

describe('catalog actions', () => {
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
      metadata: { status: 'active' },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain('ayrıntılı');
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

  it('archives through an explicit status-only mutation', async () => {
    const updateApp = vi.fn(async () => ({ error: null }));
    const result = await archiveApp(appId, catalogDependencies({ updateApp }));

    expect(result).toMatchObject({ ok: true });
    expect(updateApp).toHaveBeenCalledWith(appId, { status: 'archived' });
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
});
