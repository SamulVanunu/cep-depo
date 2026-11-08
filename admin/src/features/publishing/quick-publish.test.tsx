import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublishAppOption } from '../apps/publish-app-options';
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
});
