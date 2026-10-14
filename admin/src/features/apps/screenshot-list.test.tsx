import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScreenshotList } from './screenshot-list';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateScreenshot: vi.fn(),
  deleteScreenshot: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./asset-actions', () => ({
  updateScreenshotAction: mocks.updateScreenshot,
  deleteScreenshotAction: mocks.deleteScreenshot,
}));
vi.mock('../../lib/supabase/browser', () => ({
  getPublicAssetUrl: (path: string) => `https://assets.example.com/${path}`,
}));

const appId = 'a2000000-0000-4000-8000-000000000001';
const screenshot = {
  id: 'a3000000-0000-4000-8000-000000000001',
  path: `apps/${appId}/screenshots/a4000000-0000-4000-8000-000000000001.webp`,
  alt_text: 'Ana ekran görünümü',
  position: 0,
};

describe('ScreenshotList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateScreenshot.mockResolvedValue({ ok: true, data: null });
    mocks.deleteScreenshot.mockResolvedValue({ ok: true, data: null });
  });

  it('renders a descriptive thumbnail and refreshes after update', async () => {
    render(<ScreenshotList appId={appId} screenshots={[screenshot]} />);
    expect(screen.getByRole('img', { name: screenshot.alt_text })).toHaveAttribute(
      'src',
      `https://assets.example.com/${screenshot.path}`,
    );
    fireEvent.change(screen.getByLabelText('Alt metin'), { target: { value: 'Güncel ana ekran' } });
    fireEvent.click(screen.getByRole('button', { name: 'Güncelle' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('güncellendi');
  });

  it('refreshes after deletion but not after a failed update', async () => {
    mocks.updateScreenshot.mockResolvedValue({
      ok: false,
      error: { code: 'TEMPORARY', message: 'Güvenli hata.', correlationId: 'safe-id' },
    });
    render(<ScreenshotList appId={appId} screenshots={[screenshot]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Güncelle' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Güvenli hata.');
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  });
});
