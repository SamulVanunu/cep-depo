'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';

import { createBrowserSupabaseClient } from '../../lib/supabase/browser';
import type { ActionResult } from '../../server/errors/action-error';
import {
  createPublishingAppAction,
  deleteAppPermanentlyAction,
  type PublishingAppData,
} from '../apps/app-actions';
import type { PublishingAppInput } from '../apps/app-schema';
import {
  addScreenshotAction,
  cleanupPublishingAssetAction,
  requestAssetUploadAction,
  setAppIconAction,
} from '../apps/asset-actions';
import type { CategoryOption } from '../apps/app-dal';
import type { PublishAppOption } from '../apps/publish-app-options';
import {
  publishVersionReplacingPreviousAction,
} from '../versions/version-actions';
import { ApkStep, type ApkStepDependencies } from './apk-step';
import { AppStep } from './app-step';
import type { PublishReview, PublishWizardState, SelectedPublishApp } from './publish-types';

type PublishWizardProps = Readonly<{
  categories: readonly Pick<CategoryOption, 'id' | 'name'>[];
  initialApp: PublishAppOption | null;
  initialSelectionInvalid: boolean;
  createPublishingApp?: (input: PublishingAppInput) => Promise<ActionResult<PublishingAppData>>;
  uploadAsset?: (input: Readonly<{
    appId: string;
    operationId: string;
    kind: 'icon' | 'screenshot';
    file: File;
    altText: string;
    position: number;
  }>) => Promise<string>;
  compensateNewApp?: (input: Readonly<{ id: string; title: string; operationId: string }>) => Promise<void>;
  apkDependencies?: ApkStepDependencies;
  publishVersionReplacingPrevious?:
    typeof publishVersionReplacingPreviousAction;
}>;

async function uploadPublishingAsset(input: Readonly<{
  appId: string;
  operationId: string;
  kind: 'icon' | 'screenshot';
  file: File;
  altText: string;
  position: number;
}>): Promise<string> {
  const intent = await requestAssetUploadAction({
    appId: input.appId,
    kind: input.kind,
    fileName: input.file.name,
    mimeType: input.file.type,
    size: input.file.size,
  });
  if (!intent.ok) throw new Error('asset-intent-failed');
  const client = createBrowserSupabaseClient();
  const uploaded = await client.storage
    .from(intent.data.bucket)
    .uploadToSignedUrl(intent.data.path, intent.data.token, input.file, { contentType: input.file.type });
  if (uploaded.error) {
    await cleanupPublishingAssetAction({
      appId: input.appId,
      operationId: input.operationId,
      path: intent.data.path,
      kind: input.kind,
    });
    throw new Error('asset-upload-failed');
  }
  const saved = input.kind === 'icon'
    ? await setAppIconAction(input.appId, intent.data.path)
    : await addScreenshotAction({
        appId: input.appId,
        path: intent.data.path,
        altText: input.altText,
        position: input.position,
      });
  if (!saved.ok) {
    await cleanupPublishingAssetAction({
      appId: input.appId,
      operationId: input.operationId,
      path: intent.data.path,
      kind: input.kind,
    });
    throw new Error('asset-save-failed');
  }
  return intent.data.path;
}

async function compensatePublishingApp(input: Readonly<{ id: string; title: string; operationId: string }>) {
  void input.operationId;
  const result = await deleteAppPermanentlyAction(input.id, input.title);
  if (!result.ok) throw new Error('app-compensation-failed');
}

export function PublishWizard({
  categories,
  initialApp,
  initialSelectionInvalid,
  createPublishingApp = createPublishingAppAction,
  uploadAsset = uploadPublishingAsset,
  compensateNewApp = compensatePublishingApp,
  apkDependencies,
  publishVersionReplacingPrevious = publishVersionReplacingPreviousAction,
}: PublishWizardProps) {
  const [state, setState] = useState<PublishWizardState>({
    step: 'app',
    app: initialApp ? {
      ...initialApp,
      isNew: false,
      operationId: null,
      initialAssets: null,
    } : null,
    review: null,
    cleanupPending: false,
  });
  const publishingRef = useRef(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [cleanupPending, setCleanupPending] = useState(false);

  function continueWithApp(app: SelectedPublishApp) {
    setState(current => ({ ...current, step: 'apk', app }));
  }

  async function publish(review: PublishReview, app: SelectedPublishApp) {
    if (publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    setPublishError(null);
    setCleanupPending(false);
    try {
      const publishFn = publishVersionReplacingPrevious ?? publishVersionReplacingPreviousAction;
      const result = await publishFn(review.versionId);
      if (!result.ok) {
        setPublishError(result.error.message);
        if (app.isNew) {
          try {
            await compensateNewApp({ id: app.id, title: app.title, operationId: app.operationId ?? '' });
          } catch {
            // Compensation owns safe error reporting.
          }
          setState({ step: 'app', app: null, review: null, cleanupPending: false });
        } else {
          setState(current => ({ ...current, step: 'apk', review: null }));
        }
        return;
      }
      setCleanupPending(Boolean(result.data?.cleanupPending));
      setState(current => ({ ...current, step: 'complete', app: current.app ?? app, review, cleanupPending: Boolean(result.data?.cleanupPending) }));
    } catch {
      setPublishError('Yayınlama tamamlanamadı. Lütfen yeniden dene.');
      if (app.isNew) {
        try {
          await compensateNewApp({ id: app.id, title: app.title, operationId: app.operationId ?? '' });
        } catch {
          // Compensation owns safe error reporting.
        }
        setState({ step: 'app', app: null, review: null, cleanupPending: false });
      } else {
        setState(current => ({ ...current, step: 'apk', review: null }));
      }
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  function handleApkComplete(review: PublishReview) {
    setState(current => ({ ...current, review }));
    void publish(review, state.app!);
  }

  return (
    <div className="publish-wizard">
      <ol aria-label="Yayın adımları" className="wizard-steps">
        {[
          ['app', 'Uygulama'],
          ['apk', 'APK'],
        ].map(([step, label], index) => (
          <li aria-current={state.step === step ? 'step' : undefined} key={step}>{index + 1}. {label}</li>
        ))}
      </ol>

      {initialSelectionInvalid && state.step === 'app' ? (
        <p className="notice" role="status">Uygulama seçimi bulunamadı. Listeden başka bir uygulama seçebilirsin.</p>
      ) : null}

      {state.step === 'app' ? (
        <AppStep
          categories={categories}
          compensateNewApp={compensateNewApp}
          createPublishingApp={createPublishingApp}
          onContinue={continueWithApp}
          selectedApp={state.app}
          uploadAsset={uploadAsset}
        />
      ) : null}

      {state.step === 'apk' ? (
        <ApkStep
          app={state.app!}
          dependencies={apkDependencies}
          onComplete={handleApkComplete}
        />
      ) : null}

      {publishing ? (
        <p aria-live="polite" role="status">Yayınlama yapılıyor…</p>
      ) : null}

      {publishError ? (
        <p aria-live="assertive" role="alert">{publishError}</p>
      ) : null}

      {state.step === 'complete' && state.app ? (
        <section aria-labelledby="publish-complete-heading" className="record-form" role="status">
          <div>
            <p className="eyebrow">Yayın hazır</p>
            <h2 id="publish-complete-heading" tabIndex={-1}>Yayın tamamlandı</h2>
            <p className="muted">{state.app.title} kataloğa başarıyla yayınlandı.</p>
          </div>
          {cleanupPending ? (
            <p role="status">Yayın tamamlandı; bazı dosyalar temizleme bekliyor.</p>
          ) : null}
          <div className="button-row">
            <Link className="primary-button" href={`/apps/${state.app.id}`}>Uygulamayı yönet</Link>
            <Link className="secondary-button" href="/apps">Uygulamalara dön</Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}