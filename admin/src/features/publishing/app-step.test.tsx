import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppStep, type AppStepProps } from './app-step';

const appId = 'a2000000-0000-4000-8000-000000000001';
const operationId = 'a5000000-0000-4000-8000-000000000001';
const categories = [
  { id: 'a3000000-0000-4000-8000-000000000001', name: 'Araçlar' },
];

function setup(overrides: Partial<AppStepProps> = {}) {
  const props: AppStepProps = {
    categories,
    selectedApp: null,
    createPublishingApp: vi.fn(async input => ({
      ok: true as const,
      data: { id: appId, slug: input.slug, status: 'archived' as const, operationId },
    })),
    uploadAsset: vi.fn(async ({ kind, position }) => (
      kind === 'icon'
        ? `apps/${appId}/icons/a6000000-0000-4000-8000-000000000001.png`
        : `apps/${appId}/screenshots/a6000000-0000-4000-8000-00000000000${position + 2}.png`
    )),
    compensateNewApp: vi.fn(async () => undefined),
    onContinue: vi.fn(),
    ...overrides,
  };
  render(<AppStep {...props} />);
  return props;
}

async function fillRequiredForm(options: Readonly<{ includeIcon?: boolean }> = {}) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Uygulama adı'), 'Çağrı Öz');
  expect(screen.getByLabelText('Slug')).toHaveValue('cagri-oz');
  await user.clear(screen.getByLabelText('Slug'));
  await user.type(screen.getByLabelText('Slug'), 'ozel-slug');
  await user.selectOptions(screen.getByLabelText('Kategori'), categories[0]!.id);
  await user.type(screen.getByLabelText('Kısa açıklama'), 'Yeterince uzun kısa açıklama.');
  await user.type(screen.getByLabelText('Ayrıntılı açıklama'), 'Yeterince uzun ayrıntılı açıklama metni.');
  if (options.includeIcon !== false) {
    await user.upload(
      screen.getByLabelText('Uygulama ikonu'),
      new File(['icon'], 'icon.png', { type: 'image/png' }),
    );
  }
  return user;
}

describe('AppStep', () => {
  it('does not expose a draft selector or create staging data while complete fields are invalid', async () => {
    const props = setup();

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Mevcut uygulama')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'APK adımına devam et' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Uygulama adı');
    expect(props.createPublishingApp).not.toHaveBeenCalled();
  });

  it('requires an icon but keeps screenshots optional', async () => {
    const props = setup();
    await fillRequiredForm({ includeIcon: false });
    fireEvent.click(screen.getByRole('button', { name: 'APK adımına devam et' }));
    expect(screen.getByRole('alert')).toHaveTextContent('ikon');
    expect(props.createPublishingApp).not.toHaveBeenCalled();

    await userEvent.upload(
      screen.getByLabelText('Uygulama ikonu'),
      new File(['icon'], 'icon.png', { type: 'image/png' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'APK adımına devam et' }));
    await waitFor(() => expect(props.onContinue).toHaveBeenCalledOnce());
    expect(props.uploadAsset).toHaveBeenCalledTimes(1);
  });

  it('requires 2–180 characters of alt text for every supplied screenshot', async () => {
    const props = setup();
    await fillRequiredForm();
    await userEvent.upload(
      screen.getByLabelText('Ekran görüntüleri'),
      new File(['shot'], 'shot.png', { type: 'image/png' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'APK adımına devam et' }));

    expect(screen.getByRole('alert')).toHaveTextContent('alt metni');
    expect(props.createPublishingApp).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('shot.png alt metni'), 'Ana ekran görünümü');
    fireEvent.click(screen.getByRole('button', { name: 'APK adımına devam et' }));
    await waitFor(() => expect(props.onContinue).toHaveBeenCalledOnce());
    expect(props.uploadAsset).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'screenshot',
      altText: 'Ana ekran görünümü',
      position: 0,
      operationId,
    }));
  });

  it('compensates a newly staged app when an initial asset fails', async () => {
    const compensateNewApp = vi.fn(async () => undefined);
    const props = setup({
      compensateNewApp,
      uploadAsset: vi.fn(async () => { throw new Error('private storage detail'); }),
    });
    await fillRequiredForm();
    fireEvent.click(screen.getByRole('button', { name: 'APK adımına devam et' }));

    await waitFor(() => expect(compensateNewApp).toHaveBeenCalledWith({
      id: appId,
      title: 'Çağrı Öz',
      operationId,
    }));
    expect(props.onContinue).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).not.toHaveTextContent('private storage detail');
  });

  it('never compensates an existing app when continuing fails', async () => {
    const compensateNewApp = vi.fn(async () => undefined);
    const existing = {
      id: appId,
      title: 'Mevcut Uygulama',
      slug: 'mevcut-uygulama',
      status: 'active' as const,
      iconPath: 'apps/existing/icon.png',
      latestVersionCode: 7,
      isNew: false as const,
      operationId: null,
      initialAssets: null,
    };
    const onContinue = vi.fn(() => { throw new Error('next step failed'); });
    setup({ selectedApp: existing, compensateNewApp, onContinue });

    fireEvent.click(screen.getByRole('button', { name: 'APK adımına devam et' }));
    expect(compensateNewApp).not.toHaveBeenCalled();
  });
});
