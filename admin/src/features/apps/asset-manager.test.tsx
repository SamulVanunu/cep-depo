import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetManager } from './asset-manager';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  requestAssetUpload: vi.fn(),
  setAppIcon: vi.fn(),
  addScreenshot: vi.fn(),
  uploadToSignedUrl: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./asset-actions', () => ({
  requestAssetUploadAction: mocks.requestAssetUpload,
  setAppIconAction: mocks.setAppIcon,
  addScreenshotAction: mocks.addScreenshot,
}));
vi.mock('../../lib/supabase/browser', () => ({
  createBrowserSupabaseClient: () => ({
    storage: { from: () => ({ uploadToSignedUrl: mocks.uploadToSignedUrl }) },
  }),
  getPublicAssetUrl: (path: string) => `https://assets.example.com/${path}`,
}));

const appId = 'a2000000-0000-4000-8000-000000000001';
const iconPath = `apps/${appId}/icons/a4000000-0000-4000-8000-000000000001.png`;

function successSetup() {
  mocks.requestAssetUpload.mockResolvedValue({
    ok: true,
    data: { bucket: 'app-assets', path: iconPath, token: 'token' },
  });
  mocks.uploadToSignedUrl.mockResolvedValue({ error: null });
  mocks.setAppIcon.mockResolvedValue({ ok: true, data: null });
  mocks.addScreenshot.mockResolvedValue({ ok: true, data: null });
}

describe('AssetManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    successSetup();
  });

  it('shows the current icon and refreshes the route after a successful icon mutation', async () => {
    render(<AssetManager appId={appId} iconPath={iconPath} screenshotCount={0} />);
    expect(screen.getByRole('img', { name: 'Mevcut uygulama ikonu' })).toHaveAttribute(
      'src',
      `https://assets.example.com/${iconPath}`,
    );
    fireEvent.change(screen.getByLabelText('Uygulama ikonu'), {
      target: { files: [new File(['icon'], 'icon.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('Görsel yüklendi');
  });

  it('does not refresh when icon metadata cannot be saved', async () => {
    mocks.setAppIcon.mockResolvedValue({
      ok: false,
      error: { code: 'TEMPORARY', message: 'Güvenli hata.', correlationId: 'safe-id' },
    });
    render(<AssetManager appId={appId} iconPath={null} screenshotCount={0} />);
    fireEvent.change(screen.getByLabelText('Uygulama ikonu'), {
      target: { files: [new File(['icon'], 'icon.png', { type: 'image/png' })] },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Güvenli hata.');
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('img', { name: 'Mevcut uygulama ikonu' })).not.toBeInTheDocument();
  });

  it('resets screenshot fields and refreshes after successful metadata creation', async () => {
    const user = userEvent.setup();
    render(<AssetManager appId={appId} iconPath={null} screenshotCount={2} />);
    const altText = screen.getByLabelText('Erişilebilir alt metin');
    const fileInput = screen.getByLabelText('Ekran görüntüsü') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(['shot'], 'shot.webp', { type: 'image/webp' }),
    );
    expect(fileInput.files).toHaveLength(1);
    await user.type(altText, 'Ana ekran görünümü');
    const submit = screen.getByRole('button', { name: 'Ekran görüntüsü ekle' });
    expect(new FormData(submit.closest('form')!).get('screenshot')).toBeInstanceOf(File);
    fireEvent.submit(submit.closest('form')!);
    await waitFor(() => expect(mocks.requestAssetUpload).toHaveBeenCalledOnce());
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledOnce();
    await waitFor(() => expect(mocks.addScreenshot).toHaveBeenCalledWith(expect.objectContaining({
      altText: 'Ana ekran görünümü',
      position: 2,
    })));
    expect(altText).toHaveValue('');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
