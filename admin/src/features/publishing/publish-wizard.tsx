'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { createBrowserSupabaseClient } from '../../lib/supabase/browser';
import type { ActionResult } from '../../server/errors/action-error';
import { createQuickAppAction } from '../apps/app-actions';
import { requestAssetUploadAction, setAppIconAction } from '../apps/asset-actions';
import type { PublishAppOption } from '../apps/publish-app-options';
import { publishVersionAction } from '../versions/version-actions';
import { ApkStep, type ApkStepDependencies } from './apk-step';
import { AppStep } from './app-step';
import { ReviewStep } from './review-step';
import type { PublishWizardState, SelectedPublishApp } from './publish-types';

type QuickAppResult = ActionResult<Readonly<{
  id: string;
  slug: string;
  status: 'archived';
}>>;

type PublishWizardProps = Readonly<{
  apps: readonly PublishAppOption[];
  initialApp: PublishAppOption | null;
  initialSelectionInvalid: boolean;
  createQuickApp?: (input: Readonly<{ title: string; shortDescription: string }>) => Promise<QuickAppResult>;
  uploadIcon?: (appId: string, file: File) => Promise<string>;
  apkDependencies?: ApkStepDependencies;
  publishVersion?: typeof publishVersionAction;
}>;

async function uploadAppIcon(appId: string, file: File): Promise<string> {
  const intent = await requestAssetUploadAction({
    appId,
    kind: 'icon',
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
  });
  if (!intent.ok) throw new Error('asset-intent-failed');
  const client = createBrowserSupabaseClient();
  const uploaded = await client.storage
    .from(intent.data.bucket)
    .uploadToSignedUrl(intent.data.path, intent.data.token, file, { contentType: file.type });
  if (uploaded.error) throw new Error('asset-upload-failed');
  const saved = await setAppIconAction(appId, intent.data.path);
  if (!saved.ok) throw new Error('asset-save-failed');
  return intent.data.path;
}

export function PublishWizard({
  apps,
  initialApp,
  initialSelectionInvalid,
  createQuickApp = createQuickAppAction,
  uploadIcon = uploadAppIcon,
  apkDependencies,
  publishVersion = publishVersionAction,
}: PublishWizardProps) {
  const [state, setState] = useState<PublishWizardState>({
    step: 'app',
    app: initialApp ? { ...initialApp, isNew: false } : null,
    review: null,
  });
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const publishingRef = useRef(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    if (state.step === 'review') reviewHeadingRef.current?.focus();
  }, [state.step]);

  function continueWithApp(app: SelectedPublishApp) {
    setState(current => ({ ...current, step: 'apk', app }));
  }

  async function publish() {
    if (!state.review || publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await publishVersion(state.review.versionId);
      if (!result.ok) {
        setPublishError(result.error.message);
        return;
      }
      setState(current => ({ ...current, step: 'complete' }));
    } catch {
      setPublishError('Yayınlama tamamlanamadı. Lütfen yeniden dene.');
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  return (
    <div className="publish-wizard">
      <ol aria-label="Yayın adımları" className="wizard-steps">
        {[
          ['app', 'Uygulama'],
          ['apk', 'APK'],
          ['review', 'Kontrol ve yayın'],
        ].map(([step, label], index) => (
          <li aria-current={state.step === step ? 'step' : undefined} key={step}>{index + 1}. {label}</li>
        ))}
      </ol>

      {initialSelectionInvalid && state.step === 'app' ? (
        <p className="notice" role="status">Uygulama seçimi bulunamadı. Listeden başka bir uygulama seçebilirsin.</p>
      ) : null}

      {state.step === 'app' ? (
        <AppStep
          apps={apps}
          createQuickApp={createQuickApp}
          onContinue={continueWithApp}
          selectedApp={state.app}
          uploadIcon={uploadIcon}
        />
      ) : null}

      {state.step === 'apk' ? (
        <ApkStep
          app={state.app!}
          dependencies={apkDependencies}
          onComplete={review => setState(current => ({ ...current, step: 'review', review }))}
        />
      ) : null}

      {state.step === 'review' && state.review ? (
        <ReviewStep
          error={publishError}
          headingRef={reviewHeadingRef}
          onPublish={() => void publish()}
          pending={publishing}
          review={state.review}
        />
      ) : null}

      {state.step === 'complete' && state.app ? (
        <section aria-labelledby="publish-complete-heading" className="record-form" role="status">
          <div>
            <p className="eyebrow">Yayın hazır</p>
            <h2 id="publish-complete-heading" tabIndex={-1}>Yayın tamamlandı</h2>
            <p className="muted">{state.app.title} kataloğa başarıyla yayınlandı.</p>
          </div>
          <div className="button-row">
            <Link className="primary-button" href={`/apps/${state.app.id}`}>Uygulamayı yönet</Link>
            <Link className="secondary-button" href="/apps">Uygulamalara dön</Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
