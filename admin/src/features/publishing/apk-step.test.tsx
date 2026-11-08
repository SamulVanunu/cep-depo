import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SelectedPublishApp } from './publish-types';
import { ApkStep, type ApkStepDependencies } from './apk-step';

const app: SelectedPublishApp = {
  id: 'a1000000-0000-4000-8000-000000000001',
  title: 'Cep Araç',
  slug: 'cep-arac',
  status: 'active',
  iconPath: null,
  packageName: 'com.example.cep',
  latestVersionCode: 7,
  latestReleaseMetadata: {
    supportsMobile: false,
    supportsTv: true,
    accountRequirement: 'optional',
  },
  isNew: false,
};

function dependencies(): ApkStepDependencies {
  return {
    verifyLocalApkMagic: vi.fn(async () => undefined),
    parseApkManifest: vi.fn(async () => ({
      packageName: 'com.example.app',
      versionName: '1.2.0',
      versionCode: 8,
    })),
    hashFile: vi.fn(async () => 'a'.repeat(64)),
    createUploadIntent: vi.fn(async () => ({ ok: true, data: { endpoint: 'x', publishableKey: 'x', operationId: 'a3000000-0000-4000-8000-000000000001', bucket: 'apk-drafts', path: 'operations/a3000000-0000-4000-8000-000000000001/source.apk', token: 'token' } })) as never,
    startUpload: vi.fn(async (_intent, _file, callbacks) => {
      callbacks.onSuccess?.();
      return Object.freeze({ abort: vi.fn(async () => undefined) });
    }) as never,
    finalizeUpload: vi.fn(async () => ({ ok: true, data: { id: 'a4000000-0000-4000-8000-000000000001', status: 'draft' } })) as never,
    createExternalDraft: vi.fn(async () => ({ ok: true, data: { id: 'a4000000-0000-4000-8000-000000000001', status: 'draft', hostname: 'downloads.example.com' } })) as never,
    cleanupOrphan: vi.fn(async () => ({ ok: true, data: null })) as never,
  };
}

describe('ApkStep', () => {
  it('renders the single automatic publication button', () => {
    render(<ApkStep app={app} dependencies={dependencies()} onComplete={vi.fn()} />);
    expect(screen.getByRole('button', { name: "APK'yı yükle ve yayınla" })).toBeVisible();
  });

  it('defaults new apps to Mobile and existing apps to their latest published metadata', () => {
    const { unmount } = render(
      <ApkStep
        app={{ ...app, isNew: true, latestReleaseMetadata: null }}
        dependencies={dependencies()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByRole('group', { name: 'Desteklenen cihazlar' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Mobil' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'TV' })).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Hesap gereksinimi' })).toHaveValue('none');

    unmount();
    render(<ApkStep app={app} dependencies={dependencies()} onComplete={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Mobil' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'TV' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Hesap gereksinimi' })).toHaveValue('optional');
  });

  it('rejects an APK draft when neither platform is selected', async () => {
    const user = userEvent.setup();
    const deps = dependencies();
    render(<ApkStep app={app} dependencies={deps} onComplete={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: 'TV' }));
    await user.click(screen.getByRole('button', { name: "APK'yı yükle ve yayınla" }));

    expect(await screen.findByRole('alert')).toHaveTextContent('En az bir platform seçilmelidir.');
    expect(deps.finalizeUpload).not.toHaveBeenCalled();
    expect(deps.createExternalDraft).not.toHaveBeenCalled();
  });

  it('sends release metadata through Storage drafts and the publication review', async () => {
    const user = userEvent.setup();
    const deps = dependencies();
    const onComplete = vi.fn();
    render(<ApkStep app={app} dependencies={deps} onComplete={onComplete} />);

    await user.click(screen.getByRole('checkbox', { name: 'Mobil' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Hesap gereksinimi' }), 'required');
    await user.upload(
      screen.getByLabelText('APK dosyası'),
      new File(['PK valid'], 'release.apk', { type: 'application/vnd.android.package-archive' }),
    );
    await screen.findByRole('region', { name: 'APK manifest özeti' });
    await user.click(screen.getByRole('button', { name: "APK'yı yükle ve yayınla" }));

    await waitFor(() => expect(deps.finalizeUpload).toHaveBeenCalledWith(expect.objectContaining({
      supportsMobile: true,
      supportsTv: true,
      accountRequirement: 'required',
    })));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      releaseMetadata: {
        supportsMobile: true,
        supportsTv: true,
        accountRequirement: 'required',
      },
    }));
  });

  it('sends release metadata through external drafts', async () => {
    const user = userEvent.setup();
    const deps = dependencies();
    render(<ApkStep app={app} dependencies={deps} onComplete={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: 'HTTPS APK linki kullan' }));
    await user.click(screen.getByRole('checkbox', { name: 'Mobil' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Hesap gereksinimi' }), 'none');
    await user.upload(
      screen.getByLabelText('1. Aynı APK’nın yerel kopyası'),
      new File(['PK valid'], 'release.apk', { type: 'application/vnd.android.package-archive' }),
    );
    await user.type(
      screen.getByLabelText('2. Doğrudan HTTPS APK bağlantısı'),
      'https://downloads.example.com/release.apk',
    );
    await user.click(screen.getByRole('button', { name: "APK'yı yükle ve yayınla" }));

    await waitFor(() => expect(deps.createExternalDraft).toHaveBeenCalledWith(expect.objectContaining({
      supportsMobile: true,
      supportsTv: true,
      accountRequirement: 'none',
    })));
  });
});
