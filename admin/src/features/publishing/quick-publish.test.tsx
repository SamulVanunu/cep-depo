import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublishAppOption } from '../apps/publish-app-options';

const { refreshCatalogAction } = vi.hoisted(() => ({
  refreshCatalogAction: vi.fn(async () => ({ error: null })),
}));

vi.mock('../catalog/catalog-refresh-action', () => ({ refreshCatalogAction }));

import { QuickPublish } from './quick-publish';

const appId = 'a1000000-0000-4000-8000-000000000001';
const versionId = 'b1000000-0000-4000-8000-000000000001';
const categoryId = 'c1000000-0000-4000-8000-000000000001';

function publishApp(overrides: Partial<PublishAppOption> = {}): PublishAppOption {
  return {
    id: appId,
    title: 'Cep Araç',
    slug: 'cep-arac',
    status: 'active',
    iconPath: null,
    packageName: 'com.ornek.vizyona',
    latestVersionCode: 7,
    latestReleaseMetadata: null,
    ...overrides,
  };
}

function apkFile(): File {
  return new File([new Uint8Array(2048)], 'vizyona.apk', {
    type: 'application/vnd.android.package-archive',
  });
}

function dependencies() {
  const calls: string[] = [];
  const record = (name: string) => {
    calls.push(name);
  };
  return {
    calls,
    props: {
      createPublishingApp: vi.fn(async () => {
        record('createPublishingApp');
        return {
          ok: true as const,
          data: { id: appId, slug: 'vizyona', status: 'archived' as const, operationId: 'op-1' },
        };
      }),
      uploadAsset: vi.fn(async () => {
        record('uploadAsset');
        return 'apps/a100/icon.png';
      }),
      deleteApp: vi.fn(async () => {
        record('deleteApp');
        return {
          ok: true as const,
          data: { deleted: true as const, cleanupPending: false },
        };
      }),
      createUploadIntent: vi.fn(async () => {
        record('createUploadIntent');
        return {
          ok: true as const,
          data: {
            endpoint: 'https://upload.example',
            publishableKey: 'key',
            operationId: 'd1000000-0000-4000-8000-000000000001',
            bucket: 'apk-drafts' as const,
            path: 'operations/d100/source.apk',
            token: 'token',
          },
        };
      }),
      startUpload: vi.fn(async (_intent, _file, callbacks) => {
        record('startUpload');
        callbacks.onProgress?.(1024, 2048);
        callbacks.onSuccess?.();
        return { abort: vi.fn(async () => undefined) };
      }),
      hash: vi.fn(async () => {
        record('hash');
        return 'a'.repeat(64);
      }),
      finalizeUpload: vi.fn(async () => {
        record('finalizeUpload');
        return { ok: true as const, data: { id: versionId, status: 'draft' as const } };
      }),
      publishVersion: vi.fn(async () => {
        record('publishVersion');
        return { ok: true as const, data: { status: 'published' as const, cleanupPending: false } };
      }),
      parseApk: vi.fn(async () => ({
        packageName: 'com.ornek.vizyona',
        versionName: '1.2.3',
        versionCode: 12,
      })),
      extractIcon: vi.fn(async () => ({
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        mimeType: 'image/png' as const,
        path: 'res/mipmap-xxxhdpi/ic_launcher.png',
      })),
      retryCatalog: vi.fn(async () => true),
    },
  };
}

const categories = [{ id: categoryId, name: 'Araçlar' }];

describe('QuickPublish', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    refreshCatalogAction.mockClear();
  });

  beforeEach(() => {
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => 'e1000000-0000-4000-8000-000000000001',
    });
  });

  it('shows the confirmation for a dropped APK and requires a category', async () => {
    const { props } = dependencies();
    const user = userEvent.setup();
    render(<QuickPublish apps={[]} categories={categories} {...props} />);

    await user.upload(screen.getByLabelText('APK dosyası'), apkFile());

    expect(await screen.findByText('Sürüm 1.2.3 (12)')).toBeInTheDocument();
    expect(screen.getByLabelText('Uygulama adı')).toHaveValue('Vizyona');
    expect(screen.getByRole('button', { name: 'Yayınla' })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Kategori'), categoryId);
    expect(screen.getByRole('button', { name: 'Yayınla' })).toBeEnabled();
  });

  it('publishes a new app in one pass with the icon extracted from the apk', async () => {
    const { props, calls } = dependencies();
    const user = userEvent.setup();
    render(<QuickPublish apps={[]} categories={categories} {...props} />);

    await user.upload(screen.getByLabelText('APK dosyası'), apkFile());
    await user.selectOptions(screen.getByLabelText('Kategori'), categoryId);
    await user.click(screen.getByRole('button', { name: 'Yayınla' }));

    expect(await screen.findByText('Yayın tamamlandı')).toBeInTheDocument();
    expect(calls).toEqual([
      'createPublishingApp',
      'uploadAsset',
      'createUploadIntent',
      'startUpload',
      'hash',
      'finalizeUpload',
      'publishVersion',
    ]);
    expect(props.createPublishingApp).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId,
        title: 'Vizyona',
        slug: 'vizyona',
        featured: false,
      }),
    );
    expect(props.finalizeUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        appId,
        packageName: 'com.ornek.vizyona',
        versionName: '1.2.3',
        versionCode: 12,
        supportsMobile: true,
      }),
    );
  });

  it('refuses an archived package with an explanatory alert', async () => {
    const { props } = dependencies();
    const user = userEvent.setup();
    render(
      <QuickPublish
        apps={[publishApp({ status: 'archived' })]}
        categories={categories}
        {...props}
      />,
    );

    await user.upload(screen.getByLabelText('APK dosyası'), apkFile());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bu paket adı arşivlenmiş bir uygulamaya ait: Cep Araç.',
    );
    expect(screen.queryByText('Sürüm 1.2.3 (12)')).not.toBeInTheDocument();
  });

  it('adds a version to the existing active app without creating one', async () => {
    const { props } = dependencies();
    const user = userEvent.setup();
    render(
      <QuickPublish
        apps={[publishApp({ packageName: 'com.ornek.vizyona' })]}
        categories={categories}
        {...props}
      />,
    );

    await user.upload(screen.getByLabelText('APK dosyası'), apkFile());
    expect(await screen.findByText(/uygulamasına yeni sürüm eklenecek/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Uygulama adı')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yayınla' }));

    expect(await screen.findByText('Yayın tamamlandı')).toBeInTheDocument();
    expect(props.createPublishingApp).not.toHaveBeenCalled();
    expect(props.finalizeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ appId }),
    );
  });

  it('offers a catalog retry when the static json could not be pushed', async () => {
    const { props } = dependencies();
    props.publishVersion.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'published',
        cleanupPending: false,
        catalogWarning: { code: 'TEMPORARY', message: 'x', correlationId: 'c' },
      },
    } as never);
    const user = userEvent.setup();
    render(<QuickPublish apps={[]} categories={categories} {...props} />);

    await user.upload(screen.getByLabelText('APK dosyası'), apkFile());
    await user.selectOptions(screen.getByLabelText('Kategori'), categoryId);
    await user.click(screen.getByRole('button', { name: 'Yayınla' }));

    expect(await screen.findByText(/statik katalog JSON güncellenemedi/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: "Katalog JSON'u yeniden dene" }));

    await waitFor(() => expect(props.retryCatalog).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: "Katalog JSON'u yeniden dene" })).not.toBeInTheDocument(),
    );
  });

  it('removes the app it created when publication fails', async () => {
    const { props } = dependencies();
    props.publishVersion.mockResolvedValueOnce({
      ok: false,
      error: { code: 'TEMPORARY', message: 'Sürüm yayınlanamadı.', correlationId: 'c' },
    } as never);
    const user = userEvent.setup();
    render(<QuickPublish apps={[]} categories={categories} {...props} />);

    await user.upload(screen.getByLabelText('APK dosyası'), apkFile());
    await user.selectOptions(screen.getByLabelText('Kategori'), categoryId);
    await user.click(screen.getByRole('button', { name: 'Yayınla' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sürüm yayınlanamadı.');
    expect(props.deleteApp).toHaveBeenCalledWith(appId, 'Vizyona');
    expect(screen.getByRole('button', { name: 'Yayınla' })).toBeInTheDocument();
  });

  it('does not reuse an app created for a different package', async () => {
    const { props } = dependencies();
    props.deleteApp.mockResolvedValueOnce({
      ok: false,
      error: { code: 'TEMPORARY', message: 'Silinemedi.', correlationId: 'c' },
    } as never);
    props.publishVersion.mockResolvedValueOnce({
      ok: false,
      error: { code: 'TEMPORARY', message: 'Sürüm yayınlanamadı.', correlationId: 'c' },
    } as never);
    props.parseApk
      .mockResolvedValueOnce({
        packageName: 'com.ornek.vizyona',
        versionName: '1.2.3',
        versionCode: 12,
      })
      .mockResolvedValueOnce({
        packageName: 'com.ornek.baska',
        versionName: '2.0.0',
        versionCode: 20,
      });
    const user = userEvent.setup();
    render(<QuickPublish apps={[]} categories={categories} {...props} />);

    await user.upload(screen.getByLabelText('APK dosyası'), apkFile());
    await user.selectOptions(screen.getByLabelText('Kategori'), categoryId);
    await user.click(screen.getByRole('button', { name: 'Yayınla' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Oluşturulan uygulama silinemedi');

    await user.upload(screen.getByLabelText('APK dosyası'), apkFile());
    expect(await screen.findByText('Sürüm 2.0.0 (20)')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Kategori'), categoryId);
    await user.click(screen.getByRole('button', { name: 'Yayınla' }));

    expect(await screen.findByText('Yayın tamamlandı')).toBeInTheDocument();
    expect(props.createPublishingApp).toHaveBeenCalledTimes(2);
  });
  it('retries the publication without uploading the apk a second time', async () => {
    const { props, calls } = dependencies();
    props.publishVersion
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'TEMPORARY', message: 'Sürüm yayınlanamadı.', correlationId: 'c' },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: { status: 'published', cleanupPending: false },
      } as never);
    const user = userEvent.setup();
    render(
      <QuickPublish
        apps={[publishApp({ packageName: 'com.ornek.vizyona' })]}
        categories={categories}
        {...props}
      />,
    );

    await user.upload(screen.getByLabelText('APK dosyası'), apkFile());
    await user.click(screen.getByRole('button', { name: 'Yayınla' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sürüm yayınlanamadı.');

    await user.click(screen.getByRole('button', { name: 'Yayınla' }));

    expect(await screen.findByText('Yayın tamamlandı')).toBeInTheDocument();
    expect(props.startUpload).toHaveBeenCalledTimes(1);
    expect(props.finalizeUpload).toHaveBeenCalledTimes(1);
    expect(props.publishVersion).toHaveBeenCalledTimes(2);
    expect(calls.filter(entry => entry === 'createUploadIntent')).toHaveLength(1);
  });

  it('shows a Turkish message instead of an internal upload failure slug', async () => {
    const { props } = dependencies();
    props.uploadAsset.mockRejectedValueOnce(new Error('asset-upload-failed'));
    const user = userEvent.setup();
    render(<QuickPublish apps={[]} categories={categories} {...props} />);

    await user.upload(screen.getByLabelText('APK dosyası'), apkFile());
    await user.selectOptions(screen.getByLabelText('Kategori'), categoryId);
    await user.click(screen.getByRole('button', { name: 'Yayınla' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('İkon yüklenemedi');
    expect(alert).not.toHaveTextContent('asset-upload-failed');
  });

  it('refreshes the whole catalog when the static json could not be pushed', async () => {
    const { props } = dependencies();
    props.publishVersion.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'published',
        cleanupPending: false,
        catalogWarning: { code: 'TEMPORARY', message: 'x', correlationId: 'c' },
      },
    } as never);
    const user = userEvent.setup();
    render(<QuickPublish apps={[]} categories={categories} {...props} retryCatalog={undefined} />);

    await user.upload(screen.getByLabelText('APK dosyası'), apkFile());
    await user.selectOptions(screen.getByLabelText('Kategori'), categoryId);
    await user.click(screen.getByRole('button', { name: 'Yayınla' }));
    await user.click(await screen.findByRole('button', { name: "Katalog JSON'u yeniden dene" }));

    await waitFor(() => expect(refreshCatalogAction).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: "Katalog JSON'u yeniden dene" })).not.toBeInTheDocument(),
    );
  });

  it('revokes the icon preview url when the section unmounts', async () => {
    const createSpy = vi.fn(() => 'blob:preview');
    const revokeSpy = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: createSpy,
      revokeObjectURL: revokeSpy,
    }));
    const { props } = dependencies();
    const user = userEvent.setup();
    const { unmount } = render(<QuickPublish apps={[]} categories={categories} {...props} />);

    await user.upload(screen.getByLabelText('APK dosyası'), apkFile());
    await screen.findByText('Sürüm 1.2.3 (12)');
    unmount();

    expect(revokeSpy).toHaveBeenCalledWith('blob:preview');
  });
});
