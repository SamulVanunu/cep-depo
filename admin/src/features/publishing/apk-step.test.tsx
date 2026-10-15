import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SelectedPublishApp } from './publish-types';
import { ApkStep, type ApkStepDependencies } from './apk-step';
import { ReviewStep } from './review-step';

const app: SelectedPublishApp = {
  id: 'a1000000-0000-4000-8000-000000000001',
  title: 'Cep Araç',
  slug: 'cep-arac',
  status: 'active',
  iconPath: null,
  latestVersionCode: 7,
  isNew: false,
};

const path = 'operations/a3000000-0000-4000-8000-000000000001/source.apk';
const sha256 = 'a'.repeat(64);

function actionError(message = 'İşlem geçici olarak tamamlanamadı. Lütfen yeniden dene.') {
  return { ok: false as const, error: { code: 'TEMPORARY' as const, message, correlationId: 'safe-id' } };
}

function dependencies(overrides: Partial<ApkStepDependencies> = {}): ApkStepDependencies {
  return {
    verifyLocalApkMagic: vi.fn(async () => undefined),
    hashFile: vi.fn(async (_file, onProgress) => {
      onProgress?.(0.5);
      onProgress?.(1);
      return sha256;
    }),
    createUploadIntent: vi.fn(async () => ({
      ok: true as const,
      data: {
        endpoint: 'https://project.storage.supabase.co/storage/v1/upload/resumable/sign',
        publishableKey: 'sb_publishable_example',
        operationId: 'a3000000-0000-4000-8000-000000000001',
        bucket: 'apk-drafts' as const,
        path,
        token: 'token',
      },
    })),
    startUpload: vi.fn(async (_intent, file, callbacks) => {
      callbacks.onProgress?.(file.size / 2, file.size);
      queueMicrotask(() => callbacks.onSuccess?.());
      return Object.freeze({ abort: vi.fn(async () => undefined) });
    }),
    finalizeUpload: vi.fn(async () => ({
      ok: true as const,
      data: { id: 'a4000000-0000-4000-8000-000000000001', status: 'draft' as const },
    })),
    createExternalDraft: vi.fn(async () => ({
      ok: true as const,
      data: {
        id: 'a4000000-0000-4000-8000-000000000001',
        status: 'draft' as const,
        hostname: 'downloads.example.com',
      },
    })),
    cleanupOrphan: vi.fn(async () => ({ ok: true as const, data: null })),
    ...overrides,
  };
}

function apkFile(name = 'release.apk', type = 'application/vnd.android.package-archive') {
  return new File([new Uint8Array(2 * 1024 * 1024)], name, { type });
}

function externalApkFile() {
  return new File(
    [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff])],
    'external-release.apk',
    { type: 'application/vnd.android.package-archive' },
  );
}

function fillForm(file: File) {
  fireEvent.change(screen.getByLabelText('APK dosyası'), { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText('Sürüm adı'), { target: { value: '1.2.0' } });
  fireEvent.change(screen.getByLabelText('Sürüm kodu'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Değişiklik notları'), { target: { value: 'Daha hızlı ve güvenli.' } });
}

describe('ApkStep', () => {
  it('offers accessible Storage and external HTTPS source choices', () => {
    render(<ApkStep app={app} dependencies={dependencies()} onComplete={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'APK kaynağı' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'APK dosyası yükle' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'HTTPS APK linki kullan' })).not.toBeChecked();
  });

  it('explains both external inputs and focuses the missing local APK', async () => {
    render(<ApkStep app={app} dependencies={dependencies()} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'HTTPS APK linki kullan' }));

    expect(screen.getByText('Bu yöntem iki bilgi gerektirir:')).toBeVisible();
    expect(screen.getByText(/sunucuya yüklenmez; boyut, APK biçimi ve SHA-256 doğrulaması/i)).toBeVisible();
    const localApk = screen.getByLabelText('1. Aynı APK’nın yerel kopyası');

    fireEvent.click(screen.getByRole('button', { name: 'Harici APK bilgilerini doğrula' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Önce bağlantıdaki APK’nın aynı yerel kopyasını seç.',
    );
    expect(localApk).toHaveFocus();
  });

  it('redirects a file above the hosted 50,000,000-byte threshold to external mode', async () => {
    const file = apkFile();
    Object.defineProperty(file, 'size', { value: 50_000_001 });
    const createUploadIntent = vi.fn();
    render(<ApkStep app={app} dependencies={dependencies({ createUploadIntent })} onComplete={vi.fn()} />);
    fillForm(file);
    fireEvent.click(screen.getByRole('button', { name: 'APK dosyasını doğrula' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('50.000.000 bayt');
    expect(createUploadIntent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'HTTPS linki kullan' }));
    expect(screen.getByRole('radio', { name: 'HTTPS APK linki kullan' })).toBeChecked();
  });

  it.each([
    { name: 'yanlış uzantı', file: apkFile('release.zip') },
    { name: 'yanlış MIME', file: apkFile('release.apk', 'text/plain') },
    { name: 'boş dosya', file: new File([], 'release.apk', { type: 'application/vnd.android.package-archive' }) },
    { name: '500 MiB üzeri', file: Object.assign(apkFile(), {}) },
  ])('$name için imza istemeden düzeltilebilir hata gösterir', async ({ name, file }) => {
    if (name === '500 MiB üzeri') Object.defineProperty(file, 'size', { value: 524_288_001 });
    const createUploadIntent = vi.fn();
    render(<ApkStep app={app} dependencies={dependencies({ createUploadIntent })} onComplete={vi.fn()} />);
    fillForm(file);
    fireEvent.click(screen.getByRole('button', { name: 'APK dosyasını doğrula' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/apk/i);
    expect(createUploadIntent).not.toHaveBeenCalled();
  });

  it('shows percent and processed MiB while uploading and suppresses duplicate submit', async () => {
    const startUpload = vi.fn(async (_intent, file, callbacks) => {
      callbacks.onProgress?.(file.size / 2, file.size);
      return Object.freeze({ abort: vi.fn(async () => undefined) });
    });
    const createUploadIntent = vi.fn(dependencies().createUploadIntent);
    render(<ApkStep app={app} dependencies={dependencies({ createUploadIntent, startUpload })} onComplete={vi.fn()} />);
    fillForm(apkFile());
    const submit = screen.getByRole('button', { name: 'APK dosyasını doğrula' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(createUploadIntent).toHaveBeenCalledOnce());
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('status')).toHaveTextContent('%50');
    expect(screen.getByRole('status')).toHaveTextContent('1.00 MiB / 2.00 MiB');
  });

  it('cancels hashing before requesting an upload intent', async () => {
    const hashFile = vi.fn((_file, _onProgress, signal) => new Promise<string>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const createUploadIntent = vi.fn();
    render(<ApkStep app={app} dependencies={dependencies({ hashFile, createUploadIntent })} onComplete={vi.fn()} />);
    fillForm(apkFile());
    fireEvent.click(screen.getByRole('button', { name: 'APK dosyasını doğrula' }));
    fireEvent.click(await screen.findByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('İşlem iptal edildi'));
    expect(createUploadIntent).not.toHaveBeenCalled();
  });

  it('verifies local magic, hashes, and creates an external draft without TUS', async () => {
    const order: string[] = [];
    const verifyLocalApkMagic = vi.fn(async () => { order.push('magic'); });
    const hashFile = vi.fn(async () => {
      order.push('hash');
      return sha256;
    });
    const createExternalDraft = vi.fn(async () => {
      order.push('draft');
      return {
        ok: true as const,
        data: {
          id: 'a4000000-0000-4000-8000-000000000001',
          status: 'draft' as const,
          hostname: 'downloads.example.com',
        },
      };
    });
    const createUploadIntent = vi.fn();
    const startUpload = vi.fn();
    const onComplete = vi.fn();
    render(<ApkStep
      app={app}
      dependencies={dependencies({
        verifyLocalApkMagic,
        hashFile,
        createExternalDraft,
        createUploadIntent,
        startUpload,
      })}
      onComplete={onComplete}
    />);
    fireEvent.click(screen.getByRole('radio', { name: 'HTTPS APK linki kullan' }));
    const file = externalApkFile();
    fireEvent.change(screen.getByLabelText('1. Aynı APK’nın yerel kopyası'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('2. Doğrudan HTTPS APK bağlantısı'), {
      target: { value: 'https://downloads.example.com/releases/app.apk' },
    });
    fireEvent.change(screen.getByLabelText('Sürüm adı'), { target: { value: '1.2.0' } });
    fireEvent.change(screen.getByLabelText('Sürüm kodu'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Harici APK bilgilerini doğrula' }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      source: { kind: 'external', hostname: 'downloads.example.com' },
    })));
    expect(order).toEqual(['magic', 'hash', 'draft']);
    expect(createExternalDraft).toHaveBeenCalledWith(expect.objectContaining({
      appId: app.id,
      fileName: file.name,
      apkUrl: 'https://downloads.example.com/releases/app.apk',
      size: file.size,
      sha256,
    }));
    expect(createUploadIntent).not.toHaveBeenCalled();
    expect(startUpload).not.toHaveBeenCalled();
  });

  it('rejects wrong local APK magic before hashing or draft creation', async () => {
    const hashFile = vi.fn();
    const createExternalDraft = vi.fn();
    render(<ApkStep app={app} dependencies={dependencies({
      verifyLocalApkMagic: vi.fn(async () => { throw new Error('Seçilen dosya geçerli bir APK değil.'); }),
      hashFile,
      createExternalDraft,
    })} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'HTTPS APK linki kullan' }));
    fireEvent.change(screen.getByLabelText('1. Aynı APK’nın yerel kopyası'), {
      target: { files: [externalApkFile()] },
    });
    fireEvent.change(screen.getByLabelText('2. Doğrudan HTTPS APK bağlantısı'), {
      target: { value: 'https://downloads.example.com/releases/app.apk' },
    });
    fireEvent.change(screen.getByLabelText('Sürüm adı'), { target: { value: '1.2.0' } });
    fireEvent.change(screen.getByLabelText('Sürüm kodu'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Harici APK bilgilerini doğrula' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('geçerli bir APK değil');
    expect(hashFile).not.toHaveBeenCalled();
    expect(createExternalDraft).not.toHaveBeenCalled();
  });

  it('cancels external hashing without creating a draft and remains retryable', async () => {
    const hashFile = vi.fn((_file, _onProgress, signal) => new Promise<string>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const createExternalDraft = vi.fn();
    render(<ApkStep app={app} dependencies={dependencies({ hashFile, createExternalDraft })} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'HTTPS APK linki kullan' }));
    fireEvent.change(screen.getByLabelText('1. Aynı APK’nın yerel kopyası'), {
      target: { files: [externalApkFile()] },
    });
    fireEvent.change(screen.getByLabelText('2. Doğrudan HTTPS APK bağlantısı'), {
      target: { value: 'https://downloads.example.com/releases/app.apk' },
    });
    fireEvent.change(screen.getByLabelText('Sürüm adı'), { target: { value: '1.2.0' } });
    fireEvent.change(screen.getByLabelText('Sürüm kodu'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Harici APK bilgilerini doğrula' }));
    fireEvent.click(await screen.findByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('İşlem iptal edildi'));
    expect(screen.getByRole('button', { name: 'Harici APK bilgilerini doğrula' })).toBeEnabled();
    expect(createExternalDraft).not.toHaveBeenCalled();
  });

  it('terminates an active upload and cleans its orphan path', async () => {
    const abort = vi.fn(async () => undefined);
    const cleanupOrphan = vi.fn(async () => ({ ok: true as const, data: null }));
    const startUpload = vi.fn(async () => Object.freeze({ abort }));
    render(<ApkStep app={app} dependencies={dependencies({ startUpload, cleanupOrphan })} onComplete={vi.fn()} />);
    fillForm(apkFile());
    fireEvent.click(screen.getByRole('button', { name: 'APK dosyasını doğrula' }));
    fireEvent.click(await screen.findByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(abort).toHaveBeenCalledWith(true));
    expect(cleanupOrphan).toHaveBeenCalledWith(path);
  });

  it.each(['hash', 'sign', 'upload', 'finalize'] as const)('retries after a %s failure', async phase => {
    const base = dependencies();
    const hashFile = phase === 'hash'
      ? vi.fn().mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce(sha256)
      : base.hashFile;
    const createUploadIntent = phase === 'sign'
      ? vi.fn().mockResolvedValueOnce(actionError()).mockImplementation(base.createUploadIntent)
      : base.createUploadIntent;
    const startUpload = phase === 'upload'
      ? vi.fn()
          .mockImplementationOnce(async (_intent, _file, callbacks) => {
            queueMicrotask(() => callbacks.onError?.(new Error('private')));
            return Object.freeze({ abort: vi.fn(async () => undefined) });
          })
          .mockImplementation(base.startUpload)
      : base.startUpload;
    const finalizeUpload = phase === 'finalize'
      ? vi.fn().mockResolvedValueOnce(actionError()).mockImplementation(base.finalizeUpload)
      : base.finalizeUpload;
    const onComplete = vi.fn();
    render(<ApkStep
      app={app}
      dependencies={{ ...base, hashFile, createUploadIntent, startUpload, finalizeUpload }}
      onComplete={onComplete}
    />);
    fillForm(apkFile());
    fireEvent.click(screen.getByRole('button', { name: 'APK dosyasını doğrula' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tekrar dene' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });

  it('returns a complete review with the exact verified digest', async () => {
    const onComplete = vi.fn();
    render(<ApkStep app={app} dependencies={dependencies()} onComplete={onComplete} />);
    const file = apkFile();
    fillForm(file);
    fireEvent.click(screen.getByRole('button', { name: 'APK dosyasını doğrula' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({
      app,
      versionId: 'a4000000-0000-4000-8000-000000000001',
      versionName: '1.2.0',
      versionCode: 8,
      fileName: 'release.apk',
      size: file.size,
      sha256,
      changelog: 'Daha hızlı ve güvenli.',
      source: { kind: 'storage' },
    }));
  });
});

describe('ReviewStep', () => {
  it('shows the verified release summary and suppresses duplicate publication', () => {
    const onPublish = vi.fn();
    const review = {
      app: { ...app, isNew: true },
      versionId: 'a4000000-0000-4000-8000-000000000001',
      versionName: '1.2.0',
      versionCode: 8,
      fileName: 'release.apk',
      size: 2 * 1024 * 1024,
      sha256,
      changelog: 'Daha hızlı ve güvenli.',
      source: { kind: 'external' as const, hostname: 'downloads.example.com' },
    };
    render(<ReviewStep onPublish={onPublish} pending review={review} />);
    expect(screen.getByRole('heading', { name: 'Kontrol ve yayın' })).toBeVisible();
    expect(screen.getByText('Cep Araç')).toBeVisible();
    expect(screen.getByText(/2\.097\.152 bayt/)).toBeVisible();
    expect(screen.getByText('Otomatik kategori: Genel')).toBeVisible();
    expect(screen.getByText('Harici HTTPS')).toBeVisible();
    expect(screen.getByText('downloads.example.com')).toBeVisible();
    expect(screen.queryByText(/\/releases\/app\.apk/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('SHA-256 doğrulamasını göster'));
    expect(screen.getByText(sha256)).toBeVisible();
    const publish = screen.getByRole('button', { name: 'Yayınla' });
    expect(publish).toBeDisabled();
    fireEvent.click(publish);
    fireEvent.click(publish);
    expect(onPublish).not.toHaveBeenCalled();
  });
});
