import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PublishAppOption } from '../apps/app-dal';
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
      {...overrides}
    />,
  );
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
});
