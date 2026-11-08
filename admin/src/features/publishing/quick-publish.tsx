'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { createPublishingAppAction, deleteAppPermanentlyAction } from '../apps/app-actions';
import { refreshCatalogAction } from '../catalog/catalog-refresh-action';
import type { CategoryOption } from '../apps/app-dal';
import type { PublishAppOption } from '../apps/publish-app-options';
import { parseApkManifest, type ParsedApkManifest } from '../uploads/apk-manifest';
import { extractLauncherIconFromBlob, type LauncherIcon } from '../uploads/apk-icon';
import { validateApkFile } from '../uploads/apk-file';
import { hashFile } from '../uploads/hash-file';
import {
  startTusUpload,
  type TusCallbacks,
  type TusIntent,
  type TusUploadHandle,
} from '../uploads/tus-upload';
import { createUploadIntentAction, finalizeUploadAction } from '../uploads/upload-actions';
import { publishVersionReplacingPreviousAction } from '../versions/version-actions';
import {
  deriveDescriptions,
  deriveTitle,
  matchPackage,
  uniqueSlug,
  type PackageMatch,
} from './quick-publish-model';
import { uploadPublishingAsset } from './upload-asset';

export type QuickPublishProps = Readonly<{
  categories: readonly Pick<CategoryOption, 'id' | 'name'>[];
  apps: readonly PublishAppOption[];
  createPublishingApp?: typeof createPublishingAppAction;
  uploadAsset?: typeof uploadPublishingAsset;
  deleteApp?: typeof deleteAppPermanentlyAction;
  createUploadIntent?: typeof createUploadIntentAction;
  startUpload?: (intent: TusIntent, file: File, callbacks: TusCallbacks) => Promise<TusUploadHandle>;
  finalizeUpload?: typeof finalizeUploadAction;
  publishVersion?: typeof publishVersionReplacingPreviousAction;
  parseApk?: typeof parseApkManifest;
  extractIcon?: typeof extractLauncherIconFromBlob;
  hash?: typeof hashFile;
  retryCatalog?: () => Promise<boolean>;
}>;

type Phase = 'idle' | 'reading' | 'confirm' | 'publishing' | 'done';

type Done = Readonly<{ appId: string; title: string; catalogWarning: boolean }>;

/** A failed publication warning covers the whole catalog refresh, not only the
 * static mirror, so the retry repeats the same action the publish ran. */
async function retryCatalogRefresh(): Promise<boolean> {
  const result = await refreshCatalogAction();
  return result.error === null;
}

function newId(): string {
  return crypto.randomUUID();
}

function iconFile(icon: LauncherIcon): File {
  const extension = icon.mimeType === 'image/webp' ? 'webp' : 'png';
  return new File([icon.bytes as unknown as ArrayBuffer], `icon.${extension}`, {
    type: icon.mimeType,
  });
}

function previewIcon(icon: LauncherIcon | null): string | null {
  if (!icon) return null;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  return URL.createObjectURL(new Blob([icon.bytes as unknown as ArrayBuffer], { type: icon.mimeType }));
}

function releasePreview(url: string | null): void {
  if (!url) return;
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}

const UPLOAD_ERRORS: Readonly<Record<string, string>> = {
  'asset-intent-failed': 'İkon yüklemesi başlatılamadı. Lütfen yeniden dene.',
  'asset-upload-failed': 'İkon yüklenemedi. Lütfen yeniden dene.',
  'asset-save-failed': 'İkon uygulamaya bağlanamadı. Lütfen yeniden dene.',
};

/** Server actions answer in Turkish; internal upload failures are slugs. */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    const mapped = UPLOAD_ERRORS[error.message];
    if (mapped) return mapped;
    if (error.message.startsWith('asset-') || error.message.startsWith('tus:')) {
      return 'Dosya yüklenemedi. Lütfen yeniden dene.';
    }
    return error.message;
  }
  return 'APK yayınlanamadı. Lütfen yeniden dene.';
}

const AMBIGUOUS_PACKAGE =
  'Bu paket adı birden fazla uygulamada kayıtlı. Önce Uygulamalar sayfasından kayıtları düzelt.';

export function QuickPublish({
  categories,
  apps,
  createPublishingApp = createPublishingAppAction,
  uploadAsset = uploadPublishingAsset,
  deleteApp = deleteAppPermanentlyAction,
  createUploadIntent = createUploadIntentAction,
  startUpload: startUploadFn = startTusUpload,
  finalizeUpload = finalizeUploadAction,
  publishVersion = publishVersionReplacingPreviousAction,
  parseApk = parseApkManifest,
  extractIcon = extractLauncherIconFromBlob,
  hash = hashFile,
  retryCatalog = retryCatalogRefresh,
}: QuickPublishProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [manifest, setManifest] = useState<ParsedApkManifest | null>(null);
  const [icon, setIcon] = useState<LauncherIcon | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [match, setMatch] = useState<PackageMatch | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [supportsTv, setSupportsTv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [createdAppId, setCreatedAppId] = useState<string | null>(null);
  const [createdPackage, setCreatedPackage] = useState<string | null>(null);
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [retrying, setRetrying] = useState(false);

  const iconUploadedRef = useRef(false);
  const busyRef = useRef(false);
  const iconUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => releasePreview(iconUrlRef.current), []);

  function reset() {
    releasePreview(iconUrlRef.current);
    iconUrlRef.current = null;
    iconUploadedRef.current = false;
    setPhase('idle');
    setFile(null);
    setManifest(null);
    setIcon(null);
    setIconUrl(null);
    setMatch(null);
    setTitle('');
    setSlug('');
    setCategoryId('');
    setShortDescription('');
    setDescription('');
    setSupportsTv(false);
    setError(null);
    setProgress(0);
    setCreatedAppId(null);
    setCreatedPackage(null);
    setPendingVersionId(null);
    setDone(null);
    setRetrying(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function selectFile(next: File | null) {
    const invalid = validateApkFile(next, 'storage');
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!next) return;

    setPhase('reading');
    setError(null);
    try {
      const parsed = await parseApk(next);
      // A pending app belongs to the APK it was created from; a different
      // package must start a new app instead of publishing into that one.
      if (createdAppId && createdPackage !== parsed.packageName) {
        setCreatedAppId(null);
        setCreatedPackage(null);
        iconUploadedRef.current = false;
      }
      // A different APK is a different publication; never reuse a version
      // finalized for the file the operator just replaced.
      setPendingVersionId(null);
      const extracted = await extractIcon(next);
      const packageMatch = matchPackage(parsed.packageName, apps);

      if (packageMatch.kind === 'archived') {
        setError(
          `Bu paket adı arşivlenmiş bir uygulamaya ait: ${packageMatch.app.title}. Uygulamayı etkinleştirdikten sonra yeniden dene.`,
        );
        setPhase('idle');
        return;
      }
      if (packageMatch.kind === 'ambiguous') {
        setError(AMBIGUOUS_PACKAGE);
        setPhase('idle');
        return;
      }

      const nextTitle = packageMatch.kind === 'existing'
        ? packageMatch.app.title
        : deriveTitle(parsed.packageName);
      const nextSlug = packageMatch.kind === 'existing'
        ? packageMatch.app.slug
        : uniqueSlug(nextTitle, apps.map(app => app.slug));
      const descriptions = deriveDescriptions(nextTitle, parsed.packageName);

      releasePreview(iconUrlRef.current);
      const preview = previewIcon(extracted);
      iconUrlRef.current = preview;

      setFile(next);
      setManifest(parsed);
      setIcon(extracted);
      setIconUrl(preview);
      setMatch(packageMatch);
      setTitle(nextTitle);
      setSlug(nextSlug);
      setCategoryId('');
      setShortDescription(descriptions.shortDescription);
      setDescription(descriptions.description);
      setSupportsTv(packageMatch.kind === 'existing'
        ? (packageMatch.app.latestReleaseMetadata?.supportsTv ?? false)
        : false);
      setProgress(0);
      setPhase('confirm');
    } catch (caught) {
      setError(messageOf(caught));
      setPhase('idle');
    }
  }

  async function publish() {
    if (busyRef.current || !file || !manifest || !match) return;
    busyRef.current = true;
    setPhase('publishing');
    setError(null);
    setProgress(0);

    const currentFile = file;
    const currentManifest = manifest;
    const mimeType = currentFile.type || 'application/octet-stream';
    let appId = (createdAppId && createdPackage === currentManifest.packageName)
      ? createdAppId
      : (match.kind === 'existing' ? match.app.id : null);
    let created: string | null = null;
    // A finalized draft cannot be finalized twice: retrying after a publish
    // failure republishes the version it already created instead of uploading
    // the APK again and colliding with itself.
    let versionId = pendingVersionId;

    try {
      if (versionId === null) {
        if (!appId) {
          const createdApp = await createPublishingApp({
            categoryId,
            slug,
            title,
            shortDescription,
            description,
            featured: false,
          });
          if (!createdApp.ok) throw new Error(createdApp.error.message);
          appId = createdApp.data.id;
          created = appId;
          setCreatedAppId(appId);
          setCreatedPackage(currentManifest.packageName);
        }

        if (icon && !iconUploadedRef.current) {
          await uploadAsset({
            appId,
            operationId: newId(),
            kind: 'icon',
            file: iconFile(icon),
            altText: '',
            position: 0,
          });
          iconUploadedRef.current = true;
        }

        const intent = await createUploadIntent({
          appId,
          fileName: currentFile.name,
          mimeType,
          size: currentFile.size,
        });
        if (!intent.ok) throw new Error(intent.error.message);

        await new Promise<void>((resolve, reject) => {
          void startUploadFn({ ...intent.data, mimeType }, currentFile, {
            onProgress: (uploaded, total) => {
              setProgress(total > 0 ? Math.round((uploaded / total) * 100) : 0);
            },
            onError: reject,
            onSuccess: resolve,
          }).catch(reject);
        });

        const digest = await hash(currentFile);
        const finalized = await finalizeUpload({
          appId,
          source: 'storage',
          packageName: currentManifest.packageName,
          versionName: currentManifest.versionName,
          versionCode: currentManifest.versionCode,
          changelog: `${currentManifest.versionName} sürümü.`,
          operationId: intent.data.operationId,
          size: currentFile.size,
          sha256: digest,
          supportsMobile: true,
          supportsTv,
          accountRequirement: 'none',
        });
        if (!finalized.ok) throw new Error(finalized.error.message);
        versionId = finalized.data.id;
        setPendingVersionId(versionId);
      }

      if (versionId === null || appId === null) {
        throw new Error('Yayın yeniden denenecek kayıt bulunamadı.');
      }
      const published = await publishVersion(versionId, newId());
      if (!published.ok) throw new Error(published.error.message);
      setPendingVersionId(null);

      setDone({
        appId,
        title,
        catalogWarning: Boolean(published.data?.catalogWarning),
      });
      setPhase('done');
    } catch (caught) {
      let message = messageOf(caught);
      if (created) {
        try {
          const deleted = await deleteApp(created, title);
          if (deleted.ok) {
            setCreatedAppId(null);
            setCreatedPackage(null);
            setPendingVersionId(null);
            iconUploadedRef.current = false;
          } else {
            message = `${message} Oluşturulan uygulama silinemedi; Uygulamalar sayfasından denetle.`;
          }
        } catch {
          message = `${message} Oluşturulan uygulama silinemedi; Uygulamalar sayfasından denetle.`;
        }
      }
      setError(message);
      setPhase('confirm');
    } finally {
      busyRef.current = false;
    }
  }

  async function retry() {
    if (retrying || !done) return;
    setRetrying(true);
    setError(null);
    try {
      const ok = await retryCatalog();
      if (ok) {
        setDone({ ...done, catalogWarning: false });
      } else {
        setError('Katalog JSON yine güncellenemedi. Ayarlar sayfasından elle deneyebilirsin.');
      }
    } catch {
      setError('Katalog JSON yine güncellenemedi. Ayarlar sayfasından elle deneyebilirsin.');
    } finally {
      setRetrying(false);
    }
  }

  const isExisting = match?.kind === 'existing';
  const publishDisabled = !manifest || (isExisting ? false : categoryId === '');

  return (
    <section aria-labelledby="quick-publish-heading" className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 id="quick-publish-heading" className="text-lg font-semibold">
          APK&apos;yı bırak, gerisini sistem yapsın
        </h2>
        <p className="text-sm text-muted-foreground">
          APK&apos;dan uygulama ve sürüm otomatik oluşur; ekran görüntülerini yayından sonra
          ekleyebilirsin.
        </p>
      </div>

      <div>
        <label htmlFor="quick-publish-apk" className="block text-sm font-medium">
          APK dosyası
        </label>
        <input
          id="quick-publish-apk"
          ref={fileInputRef}
          type="file"
          accept=".apk"
          disabled={phase === 'reading' || phase === 'publishing'}
          onChange={event => {
            const next = event.target.files?.[0] ?? null;
            void selectFile(next);
          }}
        />
      </div>

      {phase === 'reading' ? <p role="status">APK okunuyor…</p> : null}

      {error ? <p role="alert">{error}</p> : null}

      {phase === 'publishing' ? <p role="status">{`Yayınlanıyor… %${progress}`}</p> : null}

      {phase === 'confirm' && manifest && match ? (
        <div className="space-y-3">
          {match.kind === 'existing' ? (
            <p>
              <strong>{match.app.title}</strong> uygulamasına yeni sürüm eklenecek.
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">{`Paket adı: ${manifest.packageName}`}</p>
          <p>{`Sürüm ${manifest.versionName} (${manifest.versionCode})`}</p>

          {iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={iconUrl} alt="APK ikonu" className="h-16 w-16 rounded" />
          ) : (
            <p className="text-sm text-muted-foreground">
              APK&apos;da launcher ikonu bulunamadı; Uygulamayı yönet sayfasından elle
              yükleyebilirsin.
            </p>
          )}

          {match.kind === 'existing' ? null : (
            <div className="space-y-3">
              <label className="block text-sm font-medium">
                Uygulama adı
                <input
                  className="mt-1 block w-full rounded border px-2 py-1"
                  value={title}
                  maxLength={90}
                  onChange={event => setTitle(event.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Kategori
                <select
                  className="mt-1 block w-full rounded border px-2 py-1"
                  value={categoryId}
                  onChange={event => setCategoryId(event.target.value)}
                >
                  <option value="">Kategori seç</option>
                  {categories.map(category => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Kısa açıklama
                <input
                  className="mt-1 block w-full rounded border px-2 py-1"
                  value={shortDescription}
                  maxLength={180}
                  onChange={event => setShortDescription(event.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Ayrıntılı açıklama
                <textarea
                  className="mt-1 block w-full rounded border px-2 py-1"
                  value={description}
                  maxLength={5000}
                  rows={4}
                  onChange={event => setDescription(event.target.value)}
                />
              </label>
              <details>
                <summary>Gelişmiş</summary>
                <label className="mt-2 block text-sm font-medium">
                  Slug
                  <input
                    className="mt-1 block w-full rounded border px-2 py-1"
                    value={slug}
                    maxLength={120}
                    onChange={event => setSlug(event.target.value)}
                  />
                </label>
              </details>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={supportsTv}
              onChange={event => setSupportsTv(event.target.checked)}
            />
            TV desteği
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-primary px-3 py-1 text-primary-foreground"
              disabled={publishDisabled}
              onClick={() => void publish()}
            >
              Yayınla
            </button>
            <button type="button" className="rounded border px-3 py-1" onClick={reset}>
              Vazgeç
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'done' && done ? (
        <div className="space-y-3">
          <h3 className="text-base font-semibold">Yayın tamamlandı</h3>
          <p>{`${done.title} kataloğa yayınlandı.`}</p>
          {done.catalogWarning ? (
            <div role="status" className="space-y-2">
              <p>
                Uygulama yayınlandı; statik katalog JSON güncellenemedi. Mobilde görünmesi için
                yeniden dene.
              </p>
              <button
                type="button"
                className="rounded border px-3 py-1"
                disabled={retrying}
                onClick={() => void retry()}
              >
                Katalog JSON&apos;u yeniden dene
              </button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Link className="rounded border px-3 py-1" href={`/apps/${done.appId}`}>
              Uygulamayı yönet
            </Link>
            <button type="button" className="rounded border px-3 py-1" onClick={reset}>
              Yeni APK yayınla
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
