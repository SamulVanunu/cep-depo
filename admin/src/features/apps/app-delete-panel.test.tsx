import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppDeletePanel } from './app-delete-panel';

const mocks = vi.hoisted(() => ({ deleteApp: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('./app-actions', () => ({ deleteAppPermanentlyAction: mocks.deleteApp }));

const appId = 'a2000000-0000-4000-8000-000000000001';
const title = 'Örnek Uygulama';

describe('AppDeletePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteApp.mockResolvedValue({ ok: true, data: { deleted: true, cleanupPending: false } });
  });

  it('gates permanent deletion on an exact typed title', async () => {
    const user = userEvent.setup();
    render(<AppDeletePanel appId={appId} title={title} />);
    const input = screen.getByRole('textbox', { name: `Onay için uygulama adını yaz: ${title}` });
    const button = screen.getByRole('button', { name: 'Kalıcı sil' });

    expect(button).toBeDisabled();
    await user.type(input, ` ${title}`);
    expect(button).toBeDisabled();
    await user.clear(input);
    await user.type(input, title);
    expect(button).toBeEnabled();
  });

  it('submits by keyboard once, disables duplicates, and focuses confirmation after failure', async () => {
    let resolve!: (value: unknown) => void;
    mocks.deleteApp.mockReturnValue(new Promise(res => { resolve = res; }));
    const user = userEvent.setup();
    render(<AppDeletePanel appId={appId} title={title} />);
    const input = screen.getByRole('textbox', { name: `Onay için uygulama adını yaz: ${title}` });
    await user.type(input, title);
    await user.keyboard('{Enter}{Enter}');

    expect(mocks.deleteApp).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Siliniyor…' })).toBeDisabled();
    resolve({ ok: false, error: { code: 'VALIDATION', message: 'Güvenli hata.', correlationId: 'safe-id' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Güvenli hata.');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('announces cleanup pending as a successful deletion rather than a failure', async () => {
    mocks.deleteApp.mockResolvedValue({ ok: true, data: { deleted: true, cleanupPending: true } });
    const user = userEvent.setup();
    render(<AppDeletePanel appId={appId} title={title} />);
    await user.type(screen.getByRole('textbox'), title);
    await user.click(screen.getByRole('button', { name: 'Kalıcı sil' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Uygulama silindi');
    expect(screen.getByRole('status')).toHaveTextContent('temizleme bekliyor');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('redirects to the app list only after database deletion succeeds', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AppDeletePanel appId={appId} title={title} />);
    await user.type(screen.getByRole('textbox'), title);
    await user.click(screen.getByRole('button', { name: 'Kalıcı sil' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/apps'));

    vi.clearAllMocks();
    mocks.deleteApp.mockResolvedValue({
      ok: false,
      error: { code: 'TEMPORARY', message: 'Güvenli hata.', correlationId: 'safe-id' },
    });
    rerender(<AppDeletePanel key="failed" appId={appId} title={title} />);
    await user.type(screen.getByRole('textbox'), title);
    await user.click(screen.getByRole('button', { name: 'Kalıcı sil' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Güvenli hata.');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('recovers safely from a rejected action and restores confirmation focus for retry', async () => {
    mocks.deleteApp.mockRejectedValueOnce(new Error('raw rejection')).mockResolvedValueOnce({
      ok: true,
      data: { deleted: true, cleanupPending: false },
    });
    const user = userEvent.setup();
    render(<AppDeletePanel appId={appId} title={title} />);
    const input = screen.getByRole('textbox');
    await user.type(input, title);

    await user.click(screen.getByRole('button', { name: 'Kalıcı sil' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('İşlem geçici olarak tamamlanamadı');
    expect(input).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Kalıcı sil' }));
    await waitFor(() => expect(mocks.deleteApp).toHaveBeenCalledTimes(2));
  });
});
