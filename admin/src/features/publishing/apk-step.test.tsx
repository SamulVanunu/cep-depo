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
    hashFile: vi.fn(async (_file, onProgress) => {
      onProgress?.(0.5);
      onProgress?.(1);
      return sha256;
    }),
    createUploadIntent: vi.fn(async () => ({
      ok: true as const,
      data: {
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
    cleanupOrphan: vi.fn(async () => ({ ok: true as const, data: null })),
    ...overrides,
  };
}

function apkFile(name = 'release.apk', type = 'application/vnd.android.package-archive') {
  return new File([new Uint8Array(2 * 1024 * 1024)], name, { type });
}

function fillForm(file: File) {
  fireEvent.change(screen.getByLabelText('APK dosyası'), { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText('Sürüm adı'), { target: { value: '1.2.0' } });
  fireEvent.change(screen.getByLabelText('Sürüm kodu'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Değişiklik notları'), { target: { value: 'Daha hızlı ve güvenli.' } });
}

describe('ApkStep', () => {
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
    };
    render(<ReviewStep onPublish={onPublish} pending review={review} />);
    expect(screen.getByRole('heading', { name: 'Kontrol ve yayın' })).toBeVisible();
    expect(screen.getByText('Cep Araç')).toBeVisible();
    expect(screen.getByText(/2\.097\.152 bayt/)).toBeVisible();
    expect(screen.getByText('Otomatik kategori: Genel')).toBeVisible();
    fireEvent.click(screen.getByText('SHA-256 doğrulamasını göster'));
    expect(screen.getByText(sha256)).toBeVisible();
    const publish = screen.getByRole('button', { name: 'Yayınla' });
    expect(publish).toBeDisabled();
    fireEvent.click(publish);
    fireEvent.click(publish);
    expect(onPublish).not.toHaveBeenCalled();
  });
});
