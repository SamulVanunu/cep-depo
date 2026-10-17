import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SelectedPublishApp } from './publish-types';
import { ApkStep, type ApkStepDependencies } from './apk-step';

const app: SelectedPublishApp = {
  id: 'a1000000-0000-4000-8000-000000000001',
  title: 'Cep Araç',
  slug: 'cep-arac',
  status: 'active',
  iconPath: null,
  latestVersionCode: 7,
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
});
