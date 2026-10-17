import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppStatusPanel } from './app-status-panel';

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), setStatus: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./app-actions', () => ({ setAppPublicationStatusAction: mocks.setStatus }));

const appId = 'a2000000-0000-4000-8000-000000000001';

describe('AppStatusPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setStatus.mockResolvedValue({ ok: true, data: { id: appId, status: 'archived' } });
  });

  it('uses the publication labels for active and archived apps', () => {
    const { rerender } = render(<AppStatusPanel appId={appId} status="active" />);
    expect(screen.getByRole('button', { name: 'Yayından kaldır' })).toBeEnabled();
    rerender(<AppStatusPanel appId={appId} status="archived" />);
    expect(screen.getByRole('button', { name: 'Tekrar yayınla' })).toBeEnabled();
  });

  it('supports keyboard submit and prevents a duplicate submission while pending', async () => {
    let resolve!: (value: unknown) => void;
    mocks.setStatus.mockReturnValue(new Promise(res => { resolve = res; }));
    const user = userEvent.setup();
    render(<AppStatusPanel appId={appId} status="active" />);
    const button = screen.getByRole('button', { name: 'Yayından kaldır' });

    button.focus();
    await user.keyboard('{Enter}{Enter}');
    expect(mocks.setStatus).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();

    resolve({ ok: true, data: { id: appId, status: 'archived' } });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('recovers safely from a rejected action and restores focus for retry', async () => {
    mocks.setStatus.mockRejectedValueOnce(new Error('raw rejection')).mockResolvedValueOnce({
      ok: true,
      data: { id: appId, status: 'archived' },
    });
    const user = userEvent.setup();
    render(<AppStatusPanel appId={appId} status="active" />);
    const button = screen.getByRole('button', { name: 'Yayından kaldır' });

    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('İşlem geçici olarak tamamlanamadı');
    expect(button).toHaveFocus();
    await user.click(button);
    await waitFor(() => expect(mocks.setStatus).toHaveBeenCalledTimes(2));
  });
});
