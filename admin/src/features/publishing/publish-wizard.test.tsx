import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PublishAppOption } from '../apps/app-dal';
import type { ApkStepDependencies } from './apk-step';
import { PublishWizard } from './publish-wizard';

const apps: readonly PublishAppOption[] = [
  {
    id: 'a1000000-0000-4000-8000-000000000001',
    title: 'Cep Araç',
    slug: 'cep-arac',
    status: 'active',
    iconPath: null,
    latestVersionCode: 7,
  },
  {
    id: 'a1000000-0000-4000-8000-000000000002',
    title: 'Arşiv Uygulaması',
    slug: 'arsiv-uygulamasi',
    status: 'archived',
    iconPath: null,
    latestVersionCode: null,
  },
];

const success = {
  ok: true as const,
  data: {
    id: 'a1000000-0000-4000-8000-000000000003',
    slug: 'yeni-uygulama',
    status: 'archived' as const,
  },
};

function renderWizard(overrides: Partial<React.ComponentProps<typeof PublishWizard>> = {}) {
  return render(
    <PublishWizard
      apps={apps}
      createQuickApp={vi.fn(async () => success)}
      initialApp={null}
      initialSelectionInvalid={false}
      uploadIcon={vi.fn(async () => undefined)}
      publishVersion={vi.fn(async () => ({ ok: true as const, data: { status: 'published' as const } }))}
      {...overrides}
    />,
  );
}

function successfulApkDependencies(): ApkStepDependencies {
  return {
    verifyLocalApkMagic: vi.fn(async () => undefined),
    hashFile: vi.fn(async () => 'b'.repeat(64)),
    createUploadIntent: vi.fn(async () => ({
      ok: true as const,
      data: {
        endpoint: 'https://project.storage.supabase.co/storage/v1/upload/resumable/sign',
        publishableKey: 'sb_publishable_example',
        operationId: 'a3000000-0000-4000-8000-000000000001',
        bucket: 'apk-drafts' as const,
        path: 'operations/a3000000-0000-4000-8000-000000000001/source.apk',
        token: 'token',
      },
    })),
    startUpload: vi.fn(async (_intent, _file, callbacks) => {
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
  };
}

async function reachReview() {
  fireEvent.click(screen.getByRole('button', { name: 'APK adımına devam et' }));
  fireEvent.change(screen.getByLabelText('APK dosyası'), {
    target: { files: [new File(['PK'], 'release.apk', { type: 'application/vnd.android.package-archive' })] },
  });
  fireEvent.change(screen.getByLabelText('Sürüm adı'), { target: { value: '1.0.0' } });
  fireEvent.change(screen.getByLabelText('Sürüm kodu'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'APK dosyasını doğrula' }));
  await screen.findByRole('heading', { name: 'Kontrol ve yayın' });
}

describe('PublishWizard application step', () => {
  it('shows a recoverable warning for an invalid preselection', () => {
    renderWizard({ initialSelectionInvalid: true });
    expect(screen.getByRole('status')).toHaveTextContent('Uygulama seçimi bulunamadı');
    expect(screen.getByRole('heading', { name: 'Uygulamayı seç' })).toBeVisible();
  });

  it('filters existing apps and continues with the selected version context', () => {
    renderWizard();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Uygulama ara' }), {
      target: { value: 'Arşiv' },
    });
    expect(screen.queryByRole('button', { name: /Cep Araç/ })).not.toBeInTheDocument();
    const archived = screen.getByRole('button', { name: /Arşiv Uygulaması/ });
    expect(archived).toHaveTextContent('Henüz sürüm yok');
    fireEvent.click(archived);
    fireEvent.click(screen.getByRole('button', { name: 'APK adımına devam et' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'APK bilgileri' }));
  });

  it('validates quick fields before calling the server and suppresses duplicate submit', async () => {
    let resolve!: (value: typeof success) => void;
    const createQuickApp = vi.fn(() => new Promise<typeof success>(done => { resolve = done; }));
    renderWizard({ createQuickApp });
    fireEvent.click(screen.getByRole('button', { name: 'Yeni uygulama oluştur' }));
    fireEvent.click(screen.getByRole('button', { name: 'Uygulamayı oluştur' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Uygulama adı');
    expect(createQuickApp).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Uygulama adı'), { target: { value: 'Yeni Uygulama' } });
    fireEvent.change(screen.getByLabelText('Kısa açıklama'), {
      target: { value: 'Yeni uygulama için yeterli kısa açıklama.' },
    });
    const submit = screen.getByRole('button', { name: 'Uygulamayı oluştur' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(createQuickApp).toHaveBeenCalledOnce();

    await act(async () => resolve(success));
    expect(screen.getByRole('heading', { name: 'APK bilgileri' })).toBeVisible();
  });

  it('renders a sanitized server action error', async () => {
    renderWizard({
      createQuickApp: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: 'CONFLICT' as const,
          message: 'Bu bilgilerle çakışan bir kayıt zaten var.',
          correlationId: 'safe-id',
        },
      })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yeni uygulama oluştur' }));
    fireEvent.change(screen.getByLabelText('Uygulama adı'), { target: { value: 'Yeni Uygulama' } });
    fireEvent.change(screen.getByLabelText('Kısa açıklama'), {
      target: { value: 'Yeni uygulama için yeterli kısa açıklama.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Uygulamayı oluştur' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('çakışan bir kayıt');
  });

  it('keeps the created app selected when optional icon upload fails and retries without recreating it', async () => {
    const createQuickApp = vi.fn(async () => success);
    const uploadIcon = vi.fn()
      .mockRejectedValueOnce(new Error('private storage detail'))
      .mockResolvedValueOnce(undefined);
    renderWizard({ createQuickApp, uploadIcon });
    fireEvent.click(screen.getByRole('button', { name: 'Yeni uygulama oluştur' }));
    fireEvent.change(screen.getByLabelText('Uygulama adı'), { target: { value: 'Yeni Uygulama' } });
    fireEvent.change(screen.getByLabelText('Kısa açıklama'), {
      target: { value: 'Yeni uygulama için yeterli kısa açıklama.' },
    });
    fireEvent.change(screen.getByLabelText('Uygulama ikonu'), {
      target: { files: [new File(['icon'], 'icon.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Uygulamayı oluştur' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('İkon yüklenemedi');
    expect(createQuickApp).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'İkonu tekrar yükle' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'APK bilgileri' })).toBeVisible());
    expect(createQuickApp).toHaveBeenCalledOnce();
    expect(uploadIcon).toHaveBeenCalledTimes(2);
  });

  it('moves a verified APK into the focused review step without publishing', async () => {
    const publishVersion = vi.fn(async () => ({ ok: true as const, data: { status: 'published' as const } }));
    renderWizard({ initialApp: apps[0]!, apkDependencies: successfulApkDependencies(), publishVersion });
    await reachReview();

    const heading = await screen.findByRole('heading', { name: 'Kontrol ve yayın' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('button', { name: 'Yayınla' })).toBeEnabled();
    expect(publishVersion).not.toHaveBeenCalled();
  });

  it('publishes once, preserves review data on failure, and completes on retry', async () => {
    type PublishResult = Awaited<ReturnType<NonNullable<React.ComponentProps<typeof PublishWizard>['publishVersion']>>>;
    let resolveFirst!: (result: PublishResult) => void;
    const publishVersion = vi.fn()
      .mockImplementationOnce(() => new Promise<PublishResult>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, data: { status: 'published' } });
    renderWizard({ initialApp: apps[0]!, apkDependencies: successfulApkDependencies(), publishVersion });
    await reachReview();

    const publish = screen.getByRole('button', { name: 'Yayınla' });
    fireEvent.click(publish);
    fireEvent.click(publish);
    expect(publishVersion).toHaveBeenCalledOnce();
    expect(publishVersion).toHaveBeenCalledWith('a4000000-0000-4000-8000-000000000001');
    await act(async () => resolveFirst({
      ok: false,
      error: { code: 'TEMPORARY', message: 'İşlem geçici olarak tamamlanamadı. Lütfen yeniden dene.', correlationId: 'safe-id' },
    }));

    expect(screen.getByText('release.apk')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar yayınla' }));
    expect(await screen.findByRole('heading', { name: 'Yayın tamamlandı' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Uygulamayı yönet' })).toHaveAttribute('href', `/apps/${apps[0]!.id}`);
    expect(screen.getByRole('link', { name: 'Uygulamalara dön' })).toHaveAttribute('href', '/apps');
  });

  it('publishes an existing archived app without passing an activation switch', async () => {
    const publishVersion = vi.fn(async () => ({ ok: true as const, data: { status: 'published' as const } }));
    renderWizard({ initialApp: apps[1]!, apkDependencies: successfulApkDependencies(), publishVersion });
    await reachReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Yayınla' }));
    await waitFor(() => expect(publishVersion).toHaveBeenCalledWith(
      'a4000000-0000-4000-8000-000000000001',
    ));
  });
});
