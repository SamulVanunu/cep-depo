import { describe, expect, it, vi } from 'vitest';

import {
  archiveApp,
  createApp,
  createCategory,
  type CatalogActionDependencies,
} from './app-actions';
import {
  createAssetUploadIntent,
  type AssetActionDependencies,
} from './asset-actions';

const actorId = 'a1000000-0000-4000-8000-000000000001';
const appId = 'a2000000-0000-4000-8000-000000000001';
const categoryId = 'a3000000-0000-4000-8000-000000000001';

function appForm(): FormData {
  const data = new FormData();
  data.set('categoryId', categoryId);
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
