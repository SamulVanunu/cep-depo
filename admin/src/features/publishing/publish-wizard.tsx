'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';

import type { ActionResult } from '../../server/errors/action-error';
import {
  createPublishingAppAction,
  deleteAppPermanentlyAction,
  type PublishingAppData,
} from '../apps/app-actions';
import type { PublishingAppInput } from '../apps/app-schema';
import type { CategoryOption } from '../apps/app-dal';
import type { PublishAppOption } from '../apps/publish-app-options';
import {
  publishVersionReplacingPreviousAction,
} from '../versions/version-actions';
import { ApkStep, type ApkStepDependencies } from './apk-step';
import { AppStep } from './app-step';
import { createPublishOperationTracker } from './publish-operation-id';
import type { PublishReview, PublishWizardState, SelectedPublishApp } from './publish-types';
import { uploadPublishingAsset } from './upload-asset';

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
  const operationTrackerRef = useRef<ReturnType<typeof createPublishOperationTracker> | null>(
    null,
  );
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [catalogWarning, setCatalogWarning] = useState<string | null>(null);
  // Remounts the APK step after a failed publish so the review can be retried:
  // that step hides its submit button once a review is complete, and the
  // operation id is only useful if the same publication can actually be tried
  // again.
  const [apkAttempt, setApkAttempt] = useState(0);

  function continueWithApp(app: SelectedPublishApp) {
    setState(current => ({ ...current, step: 'apk', app }));
  }

  /**
   * A10.36 S7.1: one catalog operation id per publication, minted in the
   * browser and reused on every retry of the same review/version. A
   * server-action-local value cannot do this: an HTTP retry is a new
   * invocation, so the id must travel as an argument.
   */
  function catalogOperation() {
    operationTrackerRef.current ??= createPublishOperationTracker(() =>
      crypto.randomUUID(),
    );
    return operationTrackerRef.current;
  }

  async function publish(review: PublishReview, app: SelectedPublishApp) {
    if (publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    setPublishError(null);
    setCleanupPending(false);
    setCatalogWarning(null);
    try {
      const publishFn = publishVersionReplacingPrevious ?? publishVersionReplacingPreviousAction;
      // The review's version is the publication identity: the same version
      // keeps its id on every retry, a new version starts a new operation.
      const operationId = catalogOperation().start(review.versionId);
      const result = await publishFn(review.versionId, operationId);
      if (!result.ok) {
        setPublishError(result.error.message);
        setApkAttempt(attempt => attempt + 1);
        if (app.isNew) {
          try {
            await compensateNewApp({ id: app.id, title: app.title, operationId: app.operationId ?? '' });
          } catch {
            // Compensation owns safe error reporting.
          }
          // A new app means a new publication; do not carry this id into it.
          catalogOperation().finish();
          setState({ step: 'app', app: null, review: null, cleanupPending: false });
        } else {
          setState(current => ({ ...current, step: 'apk', review: null }));
        }
        return;
      }
      catalogOperation().finish();
      setCleanupPending(Boolean(result.data?.cleanupPending));
      setCatalogWarning(
        result.data?.catalogWarning
          ? 'Yayın tamamlandı; public katalog JSON dosyaları yenilenemedi. Katalog kısa süre önceki hâlinde kalabilir.'
          : null,
      );
      setState(current => ({ ...current, step: 'complete', app: current.app ?? app, review, cleanupPending: Boolean(result.data?.cleanupPending) }));
    } catch {
      setPublishError('Yayınlama tamamlanamadı. Lütfen yeniden dene.');
      setApkAttempt(attempt => attempt + 1);
      if (app.isNew) {
        try {
          await compensateNewApp({ id: app.id, title: app.title, operationId: app.operationId ?? '' });
        } catch {
          // Compensation owns safe error reporting.
        }
        catalogOperation().finish();
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
          key={apkAttempt}
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
          {state.review ? (
            <section aria-label="Yayın metadata özeti" className="detail-list">
              <div>
                <dt>Desteklenen cihazlar</dt>
                <dd>{[
                  state.review.releaseMetadata.supportsMobile ? 'Mobil' : null,
                  state.review.releaseMetadata.supportsTv ? 'TV' : null,
                ].filter(Boolean).join(', ')}</dd>
              </div>
              <div>
                <dt>Hesap gereksinimi</dt>
                <dd>{{
                  none: 'Gerekmez',
                  optional: 'İsteğe bağlı',
                  required: 'Zorunlu',
                }[state.review.releaseMetadata.accountRequirement]}</dd>
              </div>
            </section>
          ) : null}
          {cleanupPending ? (
            <p role="status">Yayın tamamlandı; bazı dosyalar temizlik kuyruğunda bekliyor.</p>
          ) : null}
          {catalogWarning ? <p role="status">{catalogWarning}</p> : null}
          <div className="button-row">
            <Link className="primary-button" href={`/apps/${state.app.id}`}>Uygulamayı yönet</Link>
            <Link className="secondary-button" href="/apps">Uygulamalara dön</Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
