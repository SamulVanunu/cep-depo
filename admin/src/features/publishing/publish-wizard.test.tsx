import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PublishAppOption } from '../apps/publish-app-options';
import type { ApkStepDependencies } from './apk-step';
import { PublishWizard } from './publish-wizard';

// A10.36 S7.1 — the catalog operation id crosses the real wizard boundary.
//
// The tracker's policy only matters if the wizard actually applies it at the
// point where it calls the server action. These tests drive a failed publish
// followed by a retry and pin the argument the action receives:
//
//   * the same review (same version id) is the same publication, so its retry
//     presents the same operation id;
//   * a new review (a new version id) is a new publication, so it must not
//     inherit the failed operation's id — that id may name a sealed or failed
//     intent the producer can never replay.

const app: PublishAppOption = {
  id: 'a1000000-0000-4000-8000-000000000001',
  title: 'Cep Araç',
  slug: 'cep-arac',
  status: 'active',
  iconPath: null,
  latestVersionCode: 7,
  latestReleaseMetadata: {
    supportsMobile: true,
    supportsTv: false,
    accountRequirement: 'none',
  },
};

function apkDependencies(versionIds: readonly string[]): ApkStepDependencies {
  let call = 0;
  return {
    verifyLocalApkMagic: vi.fn(async () => undefined),
    parseApkManifest: vi.fn(async () => ({
      packageName: 'com.example.app',
      versionName: '1.2.0',
      versionCode: 8,
    })),
    hashFile: vi.fn(async () => 'a'.repeat(64)),
    createUploadIntent: vi.fn(async () => ({
      ok: true,
      data: {
        endpoint: 'x',
        publishableKey: 'x',
        operationId: 'a5000000-0000-4000-8000-000000000001',
        bucket: 'apk-drafts',
        path: 'operations/a5000000-0000-4000-8000-000000000001/source.apk',
        token: 'token',
      },
    })) as never,
    startUpload: vi.fn(async (_intent, _file, callbacks) => {
      callbacks.onSuccess?.();
      return Object.freeze({ abort: vi.fn(async () => undefined) });
    }) as never,
    finalizeUpload: vi.fn(async () => ({
      ok: true,
      data: {
        id: versionIds[Math.min(call++, versionIds.length - 1)],
        status: 'draft',
      },
    })) as never,
    createExternalDraft: vi.fn() as never,
    cleanupOrphan: vi.fn(async () => ({ ok: true, data: null })) as never,
  };
}

function failingThenSucceedingPublish() {
  let call = 0;
  return vi.fn(async (versionId: string, operationId?: string) => {
    // The call arguments are read back from `mock.calls`; naming them keeps
    // the mock's call tuple typed for the assertions below.
    void versionId;
    void operationId;
    call += 1;
    if (call === 1) {
      return {
        ok: false as const,
        error: {
          code: 'TEMPORARY' as const,
          message: 'İşlem geçici olarak tamamlanamadı.',
          correlationId: 'c1000000-0000-4000-8000-000000000001',
        },
      };
    }
    return {
      ok: true as const,
      data: { status: 'published' as const, cleanupPending: false },
    };
  });
}

async function publishTwice(versionIds: readonly [string, string]) {
  const user = userEvent.setup();
  const publishVersion = failingThenSucceedingPublish();
  const dependencies = apkDependencies(versionIds);

  render(
    <PublishWizard
      categories={[]}
      initialApp={app}
      initialSelectionInvalid={false}
      apkDependencies={dependencies}
      publishVersionReplacingPrevious={publishVersion as never}
    />,
  );

  await user.click(screen.getByRole('button', { name: 'APK adımına devam et' }));
  await user.upload(
    screen.getByLabelText('APK dosyası'),
    new File(['PK valid'], 'release.apk', {
      type: 'application/vnd.android.package-archive',
    }),
  );
  await screen.findByRole('region', { name: 'APK manifest özeti' });

  await user.click(screen.getByRole('button', { name: "APK'yı yükle ve yayınla" }));
  await waitFor(() => expect(publishVersion).toHaveBeenCalledTimes(1));

  // The failure remounts the APK step so the same publication can be tried
  // again; only the second click is a new attempt.
  await screen.findByRole('button', { name: "APK'yı yükle ve yayınla" });
  await user.upload(
    screen.getByLabelText('APK dosyası'),
    new File(['PK valid'], 'release.apk', {
      type: 'application/vnd.android.package-archive',
    }),
  );
  await screen.findByRole('region', { name: 'APK manifest özeti' });
  await user.click(screen.getByRole('button', { name: "APK'yı yükle ve yayınla" }));
  await waitFor(() => expect(publishVersion).toHaveBeenCalledTimes(2));

  return publishVersion.mock.calls;
}

describe('PublishWizard catalog operation identity', () => {
  it('reuses the operation id when the same review is retried', async () => {
    const versionId = 'a4000000-0000-4000-8000-000000000001';
    const calls = await publishTwice([versionId, versionId]);

    expect(calls[0]?.[0]).toBe(versionId);
    expect(calls[1]?.[0]).toBe(versionId);
    expect(calls[0]?.[1]).toBe(calls[1]?.[1]);
    expect(calls[0]?.[1]).toBeTruthy();
  });

  it('mints a new operation id when the retry carries a new review', async () => {
    const firstVersion = 'a4000000-0000-4000-8000-000000000001';
    const secondVersion = 'a4000000-0000-4000-8000-000000000002';
    const calls = await publishTwice([firstVersion, secondVersion]);

    expect(calls[0]?.[0]).toBe(firstVersion);
    expect(calls[1]?.[0]).toBe(secondVersion);
    expect(calls[0]?.[1]).toBeTruthy();
    expect(calls[1]?.[1]).toBeTruthy();
    expect(calls[1]?.[1]).not.toBe(calls[0]?.[1]);
  });
});
