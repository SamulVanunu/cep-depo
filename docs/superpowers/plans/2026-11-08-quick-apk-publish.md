# Hızlı APK yayını — Uygulama Planı

> **Durum:** Uygulama planı. Onaylanmadan kod değişikliği yapılmaz.
>
> **Spec:** `docs/superpowers/specs/2026-11-08-quick-apk-publish-design.md`
>
> **Sonuç:** APK Yükle sayfasının üstünde tek ekranlık hızlı yayın; APK'dan uygulama + sürüm
> otomatik, launcher ikonu sezgisel, yayın sonunda statik katalog JSON otomatik.

---

## 0. Çalışma alanı kuralları

Bu iş `feat/accounts-community` worktree'sinde yapılır, ama çalışma ağacında ~167 korumalı
değişiklik var. Bu yüzden:

- **Sadece bu planın adı geçen dosyalarına dokunulur.** `git add` her zaman dosya adıyla
  yapılır (`git add <path>`), `git add -A` / `git add .` yasak.
- `admin/src/lib/env.ts` ve `admin/src/lib/env.test.ts` **değiştirilmez**; ikisi de başka
  özelliklerin commit edilmemiş değişikliklerini taşıyor. Statik katalog env okuması
  `admin/src/features/catalog/static-json/config.ts` içinde kendi küçük şemasıyla yapılır.
- `admin/src/features/catalog/static-json/` altındaki mevcut dosyalar (`build.ts`, `dal.ts`,
  `github.ts`, `panel.tsx`, `types.ts`, testleri) bu worktree'de **untracked**; okunur,
  değiştirilmez, commit edilmez. Sadece yeni `config.ts`, `refresh.ts` ve testleri eklenir.
- `.memory/`, `.memory/CURRENT.md`, kök `1`, migration'lar, RPC'ler ve production
  veritabanı/Storage'a dokunulmaz.
- Her görev sonunda yalnızca o görevin dosyaları commit edilir.

### Doğrulama komutları

```bash
cd admin
npx vitest run <ilgili test dosyaları>
npx tsc --noEmit
npx eslint <değişen dosyalar>
```

Testlerin gerçekten koştuğu çıktı görülmeden "geçti" denmez.

### Mimari özet

```
publish/page.tsx
  ├─ QuickPublish (yeni, client)
  │    APK seç → validateApkFile → parseApkManifest → extractLauncherIconFromBlob
  │    → matchPackage(apps)  ── yeni uygulama → createPublishingAppAction
  │                          └─ mevcut aktif → o app'in id'si
  │    → uploadPublishingAsset(icon) → createUploadIntentAction → startTusUpload
  │    → finalizeUploadAction → publishVersionReplacingPreviousAction
  │    → catalogWarning varsa uyarı + POST /api/catalog/static-json
  └─ PublishWizard (değişmez)

catalog-json.ts createCatalogRefreshAction
  └─ DB/Storage yayını başarılı → static-json/refresh.publishStaticCatalogForAdmin
       config yoksa no-op; hata → { error } → mevcut catalogWarning akışı
```

---

## 1. ZIP dizini yardımcılarını dışa aç

**Dosyalar:** `admin/src/features/uploads/apk-manifest.ts`, `admin/src/features/uploads/apk-manifest.test.ts`

Bugün `readEntryData` ve merkezi dizin okuma modül içinde gizli. İkon çıkarımı aynı
mantığı kopyalamasın diye iki yardımcı dışa açılır; davranış değişmez.

- [ ] **1.1** `CentralEntry` arayüzünü `ZipEntry` olarak dışa aç ve `uncompressedSize` ekle:

```ts
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}
```

- [ ] **1.2** `parseCentralDirectory` içinde `uncompressedSize` alanını oku
      (`readU32(view, cursor + 24)`) ve entry'ye ekle. Tüm `CentralEntry` referanslarını
      `ZipEntry` yap.

- [ ] **1.3** `readEntryData`'ya isteğe bağlı limit parametresi ekle, varsayılanlar
      mevcut sabitler kalsın:

```ts
async function readEntryData(
  source: ApkByteSource,
  entry: ZipEntry,
  limits: Readonly<{ maxCompressedBytes?: number; maxUncompressedBytes?: number }> = {},
): Promise<Uint8Array> {
  const maxCompressed = limits.maxCompressedBytes ?? MAX_MANIFEST_COMPRESSED_BYTES;
  const maxUncompressed = limits.maxUncompressedBytes ?? MAX_MANIFEST_UNCOMPRESSED_BYTES;
  if (entry.compressedSize <= 0 || entry.compressedSize > maxCompressed) reject();
  if (entry.localOffset + 30 > source.size) reject();
  const header = await sliceBuffer(source, entry.localOffset, entry.localOffset + 30);
  if (header.length < 30) reject();
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (readU32(hv, 0) !== ZIP_LOCAL_SIG) reject();
  const nameLen = readU16(hv, 26);
  const extraLen = readU16(hv, 28);
  const dataOffset = entry.localOffset + 30 + nameLen + extraLen;
  if (dataOffset + entry.compressedSize > source.size) reject();

  if (entry.method === COMPRESSION_STORED) {
    if (entry.compressedSize > maxUncompressed) reject();
    return sliceBuffer(source, dataOffset, dataOffset + entry.compressedSize);
  }
  if (entry.method === COMPRESSION_DEFLATE) {
    const compressed = await sliceBuffer(source, dataOffset, dataOffset + entry.compressedSize);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(compressed);
        controller.close();
      },
    }).pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value!.length;
      if (total > maxUncompressed) {
        await reader.cancel();
        reject();
      }
      chunks.push(value!);
    }
    return concatUint8Arrays(chunks);
  }
  reject();
}
```

- [ ] **1.4** İki yeni dışa açık fonksiyon ekle (mevcut `parseApkManifestFromSource`
      içindeki 1–3. adımlar buraya taşınır):

```ts
/** Reads the ZIP central directory without reading file data. */
export async function readZipDirectory(source: ApkByteSource): Promise<readonly ZipEntry[]> {
  const size = source.size;
  const head = await sliceBuffer(source, 0, 4);
  if (
    head.length < 4 ||
    head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04
  ) {
    reject();
  }
  const tailLen = Math.min(size, TAIL_WINDOW);
  const tail = await sliceBuffer(source, size - tailLen, size);
  const eocd = findEndOfCentralDirectory(tail);
  if (!eocd) reject();
  if (eocd.cdOffset < 0 || eocd.cdSize < 0 || eocd.cdOffset + eocd.cdSize > size) reject();
  if (eocd.cdSize > MAX_CENTRAL_DIRECTORY_BYTES) reject();
  const cd = await sliceBuffer(source, eocd.cdOffset, eocd.cdOffset + eocd.cdSize);
  return parseCentralDirectory(cd, eocd.totalEntries);
}

/** Reads and decompresses one entry. */
export async function readZipEntry(
  source: ApkByteSource,
  entry: ZipEntry,
  limits: Readonly<{ maxCompressedBytes?: number; maxUncompressedBytes?: number }> = {},
): Promise<Uint8Array> {
  return readEntryData(source, entry, limits);
}
```

- [ ] **1.5** `parseApkManifestFromSource` başındaki 1–3. adımları
      `const entries = await readZipDirectory(source);` ile değiştir.

- [ ] **1.6** `apk-manifest.test.ts`'e iki test ekle: `readZipDirectory` fixture APK'da
      `AndroidManifest.xml` girdisini ve `uncompressedSize > 0` döndürür; `readZipEntry`
      manifest baytlarını döndürür ve `parseApkManifest` ile aynı sonucu verir.

- [ ] **1.7** Çalıştır:

```bash
cd admin && npx vitest run src/features/uploads/apk-manifest.test.ts
```

Beklenen: tüm testler geçer (mevcut testler dahil).

- [ ] **1.8** Commit:

```bash
git add admin/src/features/uploads/apk-manifest.ts admin/src/features/uploads/apk-manifest.test.ts
git commit -m "refactor(uploads): expose zip directory helpers for apk icon extraction"
```

---

## 2. APK dosya doğrulamasını paylaş

**Dosyalar:** `admin/src/features/uploads/apk-file.ts` (yeni), `admin/src/features/publishing/apk-step.tsx`

- [ ] **2.1** `apk-step.tsx` içindeki `validateFile` fonksiyonunu **birebir** yeni dosyaya taşı:

```ts
import { APK_MAX_BYTES, APK_MIME_TYPES, HOSTED_STORAGE_MAX_BYTES } from './upload-schema';

export type ApkFileSource = 'storage' | 'external';

export function validateApkFile(file: File | null, source: ApkFileSource): string | null {
  if (!file || file.size === 0) {
    return source === 'external'
      ? 'Önce bağlantıdaki APK’nın aynı yerel kopyasını seç.'
      : 'Geçerli bir APK dosyası seçmelisin.';
  }
  if (!file.name.toLocaleLowerCase('tr-TR').endsWith('.apk')) return 'Dosya uzantısı .apk olmalıdır.';
  const mimeType = file.type || 'application/octet-stream';
  if (!APK_MIME_TYPES.includes(mimeType as (typeof APK_MIME_TYPES)[number])) {
    return 'Seçilen dosyanın APK türü doğrulanamadı.';
  }
  if (file.size > APK_MAX_BYTES) return 'APK dosyası 500 MiB sınırını aşamaz.';
  if (source === 'storage' && file.size > HOSTED_STORAGE_MAX_BYTES) {
    return 'Supabase Storage bu planda 50.000.000 bayt üzerindeki APK dosyalarını kabul etmez.';
  }
  return null;
}
```

- [ ] **2.2** `apk-step.tsx`: yerel fonksiyonu sil, `validateApkFile` import et, çağrıları
      güncelle. Artık kullanılmayan `APK_MAX_BYTES` / `APK_MIME_TYPES` importlarını kaldır
      (`HOSTED_STORAGE_MAX_BYTES` satır 380'de hâlâ kullanılıyor).

- [ ] **2.3** Çalıştır: `npx vitest run src/features/publishing/apk-step.test.tsx` — mevcut
      mesaj testleri aynen geçmeli.

- [ ] **2.4** Commit:

```bash
git add admin/src/features/uploads/apk-file.ts admin/src/features/publishing/apk-step.tsx
git commit -m "refactor(uploads): share apk file validation"
```

---

## 3. Launcher ikonu çıkarma

**Dosyalar:** `admin/src/features/uploads/apk-icon.ts` (yeni), `apk-icon.test.ts` (yeni),
`admin/src/features/uploads/fixtures/manifest-apk.ts`

### 3.1 Fixture

- [ ] `manifest-apk.ts` sonuna dışa açık fixture ekle (mevcut `assembleZip`, `crc32`,
      `deflateRaw`, `blobFromBytes`, `buildManifestXml` kullanılır):

```ts
/** Builds a structurally valid APK that also carries arbitrary ZIP entries. */
export async function createApkWithEntries(
  entries: readonly Readonly<{ name: string; data: Uint8Array; method?: number }>[],
): Promise<Blob> {
  const axml = buildManifestXml();
  const specs: ZipEntrySpec[] = [
    { name: 'AndroidManifest.xml', data: axml, method: COMPRESSION_STORED, crc: crc32(axml) },
  ];
  for (const entry of entries) {
    const method = entry.method ?? COMPRESSION_STORED;
    const stored = method === COMPRESSION_DEFLATE ? await deflateRaw(entry.data) : entry.data;
    specs.push({
      name: entry.name,
      data: stored,
      method,
      uncompressedSize: entry.data.length,
      crc: crc32(entry.data),
    });
  }
  return blobFromBytes(assembleZip(specs));
}
```

### 3.2 Modül

- [ ] `apk-icon.ts`:

```ts
import {
  blobByteSource,
  readZipDirectory,
  readZipEntry,
  type ApkByteSource,
  type ZipEntry,
} from './apk-manifest';

export type LauncherIcon = Readonly<{
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/webp';
  path: string;
}>;

/** Tek ikon dosyası için üst sınır. */
export const MAX_ICON_BYTES = 2 * 1024 * 1024;

const DENSITIES: Readonly<Record<string, number>> = {
  ldpi: 1, mdpi: 2, hdpi: 3, xhdpi: 4, xxhdpi: 5, xxxhdpi: 6,
};
const MIPMAP_RASTER = /^res\/mipmap-[^/]+\/[^/]+\.(png|webp)$/i;
const DENSITY_DIR = /^res\/mipmap-([a-z]+)(?:-v\d+)?\//i;
const LAUNCHER_NAME = /^ic_launcher/i;
const LAYER_NAME = /(foreground|background|monochrome)/i;

function baseName(entry: ZipEntry): string {
  return entry.name.slice(entry.name.lastIndexOf('/') + 1);
}

function densityOf(entry: ZipEntry): number {
  const match = DENSITY_DIR.exec(entry.name);
  if (!match) return 0;
  return DENSITIES[match[1]!.toLowerCase()] ?? 0;
}

function withinLimits(entry: ZipEntry): boolean {
  return entry.uncompressedSize > 0 && entry.uncompressedSize <= MAX_ICON_BYTES;
}

function compareCandidates(left: ZipEntry, right: ZipEntry): number {
  const density = densityOf(right) - densityOf(left);
  if (density !== 0) return density;
  const exact = Number(/^ic_launcher\./i.test(baseName(right)))
    - Number(/^ic_launcher\./i.test(baseName(left)));
  if (exact !== 0) return exact;
  const size = right.uncompressedSize - left.uncompressedSize;
  if (size !== 0) return size;
  return left.name.localeCompare(right.name);
}

/** Sıralı aday listesi; ilk geçerli görsel ikon olarak kullanılır. */
export function rankLauncherIcons(entries: readonly ZipEntry[]): readonly ZipEntry[] {
  const rasters = entries.filter(entry => MIPMAP_RASTER.test(entry.name) && withinLimits(entry));
  const launchers = rasters.filter(entry => LAUNCHER_NAME.test(baseName(entry)));
  const clean = launchers.filter(entry => !LAYER_NAME.test(baseName(entry)));
  const pool = clean.length > 0 ? clean : launchers.length > 0 ? launchers : rasters;
  return Object.freeze([...pool].sort(compareCandidates));
}

/** Görsel türünü uzantıya değil baytlara göre belirler. */
export function iconMimeType(bytes: Uint8Array): 'image/png' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export async function extractLauncherIcon(source: ApkByteSource): Promise<LauncherIcon | null> {
  const ranked = rankLauncherIcons(await readZipDirectory(source));
  for (const entry of ranked) {
    try {
      const bytes = await readZipEntry(source, entry, {
        maxCompressedBytes: MAX_ICON_BYTES,
        maxUncompressedBytes: MAX_ICON_BYTES,
      });
      const mimeType = iconMimeType(bytes);
      if (mimeType) return Object.freeze({ bytes, mimeType, path: entry.name });
    } catch {
      // Bozuk ya da sınırı aşan aday: sıradaki adaya geç.
    }
  }
  return null;
}

/** Tarayıcı girişi: ikon çıkarımı asla yayını engellemez. */
export async function extractLauncherIconFromBlob(file: Blob): Promise<LauncherIcon | null> {
  try {
    return await extractLauncherIcon(blobByteSource(file));
  } catch {
    return null;
  }
}
```

### 3.3 Testler

- [ ] `apk-icon.test.ts` (fixture yardımcıları):

```ts
function png(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

function webp(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
}
```

Testler:

1. `xxxhdpi` ikonu `hdpi` ikonuna tercih edilir.
2. `ic_launcher_foreground.png` varken `ic_launcher.png` seçilir.
3. Aynı yoğunlukta daha büyük dosya seçilir.
4. Launcher adı yoksa `res/mipmap-*` altındaki raster kullanılır.
5. `image/webp` baytları doğru MIME ile döner.
6. Geçersiz görsel baytı olan aday atlanır, sıradaki kullanılır.
7. `MAX_ICON_BYTES` üstündeki aday atlanır.
8. Sadece `ic_launcher.xml` (adaptive) varsa `null` döner.
9. `extractLauncherIconFromBlob` ZIP olmayan blob için `null` döner.

- [ ] Çalıştır: `npx vitest run src/features/uploads/apk-icon.test.ts`

- [ ] Commit:

```bash
git add admin/src/features/uploads/apk-icon.ts admin/src/features/uploads/apk-icon.test.ts admin/src/features/uploads/fixtures/manifest-apk.ts
git commit -m "feat(uploads): extract launcher icon from apk zip entries"
```

---

## 4. Statik katalog env yapılandırması

**Dosyalar:** `admin/src/features/catalog/static-json/config.ts` (yeni), `config.test.ts` (yeni)

`lib/env.ts` korumalı olduğu için aynı anahtarlar burada küçük bir şemayla okunur. Geçersiz
ya da eksik yapılandırma `null` döner: statik aktarım sessizce kapalı kalır, APK yayını
asla bu yüzden durmaz. Ayarlar sayfası yapılandırmayı zaten görünür kılıyor.

- [ ] `config.ts`:

```ts
import { z } from 'zod';

import type { StaticCatalogGithubConfig } from './github';

export type StaticCatalogEnvSource = Readonly<Record<string, string | undefined>>;

const optionalText = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const staticCatalogSchema = z.object({
  repo: z.preprocess(
    value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).optional(),
  ),
  branch: z.string().trim().min(1).default('main'),
  path: z
    .string()
    .trim()
    .refine(
      value =>
        value === '' ||
        (/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(value) &&
          !value.split('/').includes('..')),
      { message: 'Geçersiz klasör' },
    )
    .default('catalog'),
  token: optionalText,
});

/** Static catalog publishing config; null when disabled or invalid. */
export function getStaticCatalogConfig(
  source: StaticCatalogEnvSource = process.env,
): StaticCatalogGithubConfig | null {
  const parsed = staticCatalogSchema.safeParse({
    repo: source.CATALOG_JSON_REPO,
    branch: source.CATALOG_JSON_BRANCH,
    path: source.CATALOG_JSON_PATH,
    token: source.CATALOG_JSON_GITHUB_TOKEN,
  });
  if (!parsed.success) return null;
  const { repo, branch, path, token } = parsed.data;
  if (!repo || !token) return null;
  return { repo, branch, path, token };
}

export function hasStaticCatalogConfig(
  source: StaticCatalogEnvSource = process.env,
): boolean {
  return getStaticCatalogConfig(source) !== null;
}
```

- [ ] `config.test.ts`: eksik repo/token → `null`; boş string → `null`; geçersiz repo
      (`not-a-repo`) → `null`; varsayılanlar `main` / `catalog`; özel branch ve path;
      boş path kabul edilir.

- [ ] Çalıştır: `npx vitest run src/features/catalog/static-json/config.test.ts`

- [ ] Commit:

```bash
git add admin/src/features/catalog/static-json/config.ts admin/src/features/catalog/static-json/config.test.ts
git commit -m "feat(catalog): read static catalog github config"
```

---

## 5. Statik yayın sarmalayıcısı

**Dosyalar:** `admin/src/features/catalog/static-json/refresh.ts` (yeni), `refresh.test.ts` (yeni)

- [ ] `refresh.ts`:

```ts
import type { AdminIdentity } from '../../server/auth/require-admin';
import type { ActionError, ActionErrorCode } from '../../server/errors/action-error';
import { ActionException, toActionError } from '../../server/errors/action-error';
import { getStaticCatalogConfig } from './config';
import { buildStaticCatalogForAdmin } from './dal';
import {
  publishStaticCatalog,
  StaticCatalogPublishError,
  type StaticCatalogGithubConfig,
} from './github';
import type { StaticCatalogBundle } from './types';

export function staticCatalogErrorCode(status: number): ActionErrorCode {
  if (status === 401 || status === 403) return 'FORBIDDEN';
  if (status === 409 || status === 422) return 'CONFLICT';
  if (status === 400 || status === 404) return 'VALIDATION';
  return 'TEMPORARY';
}

export type StaticCatalogRefreshDependencies = Readonly<{
  config(): StaticCatalogGithubConfig | null;
  build(identity: AdminIdentity): Promise<StaticCatalogBundle>;
  publish(bundle: StaticCatalogBundle, config: StaticCatalogGithubConfig): Promise<unknown>;
}>;

export function defaultStaticCatalogRefreshDependencies(): StaticCatalogRefreshDependencies {
  return {
    config: () => getStaticCatalogConfig(),
    build: identity => buildStaticCatalogForAdmin(identity),
    publish: (bundle, config) => publishStaticCatalog(bundle, config),
  };
}

/**
 * Publishes the static JSON set when the feature is configured. Returns null on
 * success or when disabled; a failure becomes an ActionError the caller turns
 * into a catalog warning — it must never roll back a version publication.
 */
export async function publishStaticCatalogForAdmin(
  identity: AdminIdentity,
  dependencies: StaticCatalogRefreshDependencies = defaultStaticCatalogRefreshDependencies(),
): Promise<ActionError | null> {
  const config = dependencies.config();
  if (!config) return null;
  try {
    const bundle = await dependencies.build(identity);
    await dependencies.publish(bundle, config);
    return null;
  } catch (error) {
    if (error instanceof StaticCatalogPublishError) {
      return toActionError(new ActionException(staticCatalogErrorCode(error.status)));
    }
    return toActionError(error);
  }
}
```

- [ ] `refresh.test.ts` başında `vi.mock('server-only', () => ({}));` (dal.ts server-only
      import ediyor). Enjekte edilen bağımlılıklarla testler:

1. config `null` → sonuç `null`, `build`/`publish` çağrılmaz.
2. Başarı → `null`; `build` identity ile, `publish` bundle + config ile çağrılır.
3. `new StaticCatalogPublishError('x', 403)` → `FORBIDDEN`.
4. `409` → `CONFLICT`, `404` → `VALIDATION`, `500` → `TEMPORARY`.
5. Düz `Error` → `INTERNAL`.

- [ ] Çalıştır: `npx vitest run src/features/catalog/static-json/refresh.test.ts`

- [ ] Commit:

```bash
git add admin/src/features/catalog/static-json/refresh.ts admin/src/features/catalog/static-json/refresh.test.ts
git commit -m "feat(catalog): wrap static catalog github publishing"
```

---

## 6. Katalog yenilemesine statik adımı ekle

**Dosyalar:** `admin/src/features/catalog/catalog-json.ts`, `admin/src/features/catalog/catalog-json.test.ts`

- [ ] **6.1** Import ve varsayılan adım:

```ts
import { hasStaticCatalogConfig } from './static-json/config';

export type StaticCatalogPublishStep =
  (identity: AdminIdentity) => Promise<ActionError | null>;

async function defaultStaticPublishStep(identity: AdminIdentity): Promise<ActionError | null> {
  if (!hasStaticCatalogConfig()) return null;
  const { publishStaticCatalogForAdmin } = await import('./static-json/refresh');
  return publishStaticCatalogForAdmin(identity);
}
```

Not: `hasStaticCatalogConfig` bayrağı önce kontrol edilir; env yoksa `refresh.ts` hiç
yüklenmez (mevcut testler `server-only` mock'lamak zorunda kalmaz).

- [ ] **6.2** `createCatalogRefreshAction` imzasına üçüncü parametreyi ekle:

```ts
export function createCatalogRefreshAction(
  authorize: () => Promise<AdminIdentity>,
  recordAudit?: (input: Readonly<{
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata: Readonly<Record<string, string | number | boolean>>;
  }>) => Promise<{ error: MutationError }>,
  publishStatic: StaticCatalogPublishStep = defaultStaticPublishStep,
): CatalogRefreshAction {
```

- [ ] **6.3** Fonksiyonun sonunda, mevcut `if (result.error && recordAudit) { ... }`
      bloğundan **sonra**, `return result;` yerine:

```ts
    if (!result.error) {
      const staticError = await publishStatic(identity);
      if (staticError) {
        if (recordAudit) {
          try {
            await recordAudit({
              actorId: identity.userId,
              action: 'catalog.static_refresh_failed',
              targetType: 'catalog',
              targetId: 'catalog',
              metadata: { code: staticError.code },
            });
          } catch {
            // Audit is best-effort; the caller already holds the warning.
          }
        }
        return { error: staticError };
      }
    }
    return result;
```

- [ ] **6.4** `catalog-json.test.ts`'e file-scope `beforeEach` ekle (testleri hermetic yap):

```ts
beforeEach(() => {
  delete process.env.CATALOG_JSON_REPO;
  delete process.env.CATALOG_JSON_GITHUB_TOKEN;
});
```

Mevcut `describe`'lardaki `beforeEach`'leri ezmemek için bunu en üst seviyeye koy.

- [ ] **6.5** Mevcut `createCatalogRefreshAction CATALOG_JSON_ENABLED gate` describe'ına,
      "runs the full refresh when the flag is exactly true" testindeki harness'ı kullanarak:

1. Başarılı yenilemede `publishStatic` bir kez `identity` ile çağrılır, sonuç `ok`.
2. `publishStatic` `{ code: 'FORBIDDEN', ... }` dönerse sonuçtaki `error.code` `FORBIDDEN`
   olur ve `recordAudit` `catalog.static_refresh_failed` ile çağrılır.
3. Storage yüklemesi hata verirse `publishStatic` **çağrılmaz**.

- [ ] **6.6** Çalıştır:

```bash
npx vitest run src/features/catalog/catalog-json.test.ts src/features/versions/version-service.test.ts
```

- [ ] Commit:

```bash
git add admin/src/features/catalog/catalog-json.ts admin/src/features/catalog/catalog-json.test.ts
git commit -m "feat(catalog): push static catalog json after a successful refresh"
```

---

## 7. Ortak varlık yükleme modülü

**Dosyalar:** `admin/src/features/publishing/upload-asset.ts` (yeni), `admin/src/features/publishing/publish-wizard.tsx`

- [ ] **7.1** `publish-wizard.tsx` içindeki `uploadPublishingAsset` fonksiyonunu **birebir**
      yeni modüle taşı ve `export` et. Importları da taşı:
      `createBrowserSupabaseClient`, `requestAssetUploadAction`,
      `cleanupPublishingAssetAction`, `setAppIconAction`, `addScreenshotAction`.

- [ ] **7.2** `publish-wizard.tsx`: `import { uploadPublishingAsset } from './upload-asset';`
      ekle, yerel fonksiyonu ve artık kullanılmayan importları sil.

- [ ] **7.3** Çalıştır: `npx vitest run src/features/publishing/publish-wizard.test.tsx`

- [ ] Commit:

```bash
git add admin/src/features/publishing/upload-asset.ts admin/src/features/publishing/publish-wizard.tsx
git commit -m "refactor(publishing): share asset upload with quick publish"
```

---

## 8. Paket adını yayın akışına taşı

**Dosyalar:** `admin/src/features/apps/publish-app-options.ts`, `app-dal.ts`,
`publish-app-options.test.ts`, `publish-selection.test.ts`, `publish-wizard.test.tsx`

- [ ] **8.1** `PublishAppOption` ve `PublishAppRow` tiplerine `packageName: string | null`
      / `package_name: string | null` ekle; `mapPublishAppOptions` içinde
      `packageName: row.package_name` döndür.

- [ ] **8.2** `app-dal.ts` → `listPublishApps` select listesine `package_name` ekle.

- [ ] **8.3** Üç test dosyasındaki fixture'lara `packageName` alanını ekle
      (ör. `packageName: 'com.example.app'`, ikinci fixture'da `null`) ve
      `publish-app-options.test.ts` beklenen çıktısına `packageName` satırlarını ekle.

- [ ] **8.4** Çalıştır:

```bash
npx vitest run src/features/apps/publish-app-options.test.ts \
  src/features/publishing/publish-selection.test.ts \
  src/features/publishing/publish-wizard.test.tsx
```

- [ ] Commit:

```bash
git add admin/src/features/apps/publish-app-options.ts admin/src/features/apps/publish-app-options.test.ts \
  admin/src/features/apps/app-dal.ts admin/src/features/publishing/publish-selection.test.ts \
  admin/src/features/publishing/publish-wizard.test.tsx
git commit -m "feat(admin): expose app package name to publish flows"
```

---

## 9. Slug normalizer'ını dışa aç

**Dosyalar:** `admin/src/features/apps/app-schema.ts`

- [ ] **9.1** `function normalizeSlug` → `export function normalizeSlug`. Gövde değişmez.

- [ ] **9.2** Çalıştır: `npx vitest run src/features/apps` (mevcut şema testleri geçmeli).

- [ ] Commit:

```bash
git add admin/src/features/apps/app-schema.ts
git commit -m "refactor(admin): export slug normalizer"
```

---

## 10. Hızlı yayın modeli (saf fonksiyonlar)

**Dosyalar:** `admin/src/features/publishing/quick-publish-model.ts` (yeni), `quick-publish-model.test.ts` (yeni)

- [ ] `quick-publish-model.ts`:

```ts
import { normalizeSlug } from '../apps/app-schema';
import type { PublishAppOption } from '../apps/publish-app-options';

export type PackageMatch =
  | Readonly<{ kind: 'new' }>
  | Readonly<{ kind: 'existing'; app: PublishAppOption }>
  | Readonly<{ kind: 'archived'; app: PublishAppOption }>
  | Readonly<{ kind: 'ambiguous'; count: number }>;

export function matchPackage(
  packageName: string,
  apps: readonly PublishAppOption[],
): PackageMatch {
  const matches = apps.filter(app => app.packageName === packageName);
  if (matches.length === 0) return { kind: 'new' };
  if (matches.length > 1) return { kind: 'ambiguous', count: matches.length };
  const app = matches[0]!;
  return app.status === 'active'
    ? { kind: 'existing', app }
    : { kind: 'archived', app };
}

/** `com.ornek.vizyona` → `Vizyona`; son parça 2 karakterden kısaysa paket adı kalır. */
export function deriveTitle(packageName: string): string {
  const segments = packageName.split('.').filter(Boolean);
  const last = (segments.at(-1) ?? packageName).replace(/[_-]+/g, ' ').trim();
  if (last.length < 2) return packageName.slice(0, 90);
  const titled = last.charAt(0).toLocaleUpperCase('tr-TR') + last.slice(1);
  return titled.slice(0, 90);
}

/** Çakışmada `-2`, `-3`, … sonekini dener. */
export function uniqueSlug(base: string, taken: readonly string[]): string {
  const normalized = normalizeSlug(base) || 'uygulama';
  const takenSet = new Set(taken);
  if (!takenSet.has(normalized)) return normalized;
  for (let suffix = 2; suffix <= 9999; suffix += 1) {
    const candidate = `${normalized.slice(0, 115)}-${suffix}`;
    if (!takenSet.has(candidate)) return candidate;
  }
  return `${normalized.slice(0, 108)}-${Date.now().toString(36)}`;
}

export function deriveDescriptions(
  title: string,
  packageName: string,
): Readonly<{ shortDescription: string; description: string }> {
  return {
    shortDescription: `${title} Android uygulaması.`.slice(0, 180),
    description: `${title} Android uygulaması.\n\nPaket adı: ${packageName}`.slice(0, 5000),
  };
}
```

- [ ] `quick-publish-model.test.ts`: yeni / mevcut / arşivli / çoklu eşleşme; başlık
      türetme (`com.ornek.vizyona` → `Vizyona`, `com.ornek.my_app` → `My app`,
      `a.b` → `a.b`); slug çakışması (`vizyona` → `vizyona-2` → `vizyona-3`, Türkçe
      karakter normalizasyonu); açıklama uzunlukları.

- [ ] Çalıştır: `npx vitest run src/features/publishing/quick-publish-model.test.ts`

- [ ] Commit:

```bash
git add admin/src/features/publishing/quick-publish-model.ts admin/src/features/publishing/quick-publish-model.test.ts
git commit -m "feat(publishing): derive quick publish metadata from the apk"
```

---

## 11. Hızlı yayın bileşeni

**Dosyalar:** `admin/src/features/publishing/quick-publish.tsx` (yeni), `quick-publish.test.tsx` (yeni)

### 11.1 Bileşen sözleşmesi

```tsx
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
```

Varsayılan `retryCatalog`:

```ts
async function retryStaticCatalog(): Promise<boolean> {
  const response = await fetch('/api/catalog/static-json', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return response.ok;
}
```

### 11.2 Durum ve akış

```ts
type Phase = 'idle' | 'reading' | 'confirm' | 'publishing' | 'done';
```

Durum alanları: `phase, file, manifest, icon, iconUrl, match, title, slug, categoryId,
shortDescription, description, supportsTv, error, progress, createdAppId, done, retrying`;
ref'ler: `iconUploadedRef`, `busyRef`, `iconUrlRef`.

**Dosya seçimi** (`selectFile`):

1. `validateApkFile(next, 'storage')` → hata varsa `error` göster, `idle` kal.
2. `parseApk(next)` ve `extractIcon(next)` paralel değil, sırayla (aynı dosya).
3. `matchPackage(parsed.packageName, apps)`:
   - `archived` → `error`: `Bu paket adı arşivlenmiş bir uygulamaya ait: <title>. Uygulamayı etkinleştirdikten sonra yeniden dene.`, `idle` kal.
   - `ambiguous` → `error`: `Bu paket adı birden fazla uygulamada kayıtlı. Önce Uygulamalar sayfasından kayıtları düzelt.`
4. Başlık: eşleşme varsa `match.app.title`, yoksa `deriveTitle(packageName)`.
5. Slug: eşleşme varsa `match.app.slug`, yoksa `uniqueSlug(title, apps.map(a => a.slug))`.
6. Açıklamalar `deriveDescriptions(title, packageName)`.
7. İkon önizlemesi: `URL.createObjectURL` varsa blob URL, yoksa (jsdom) önizleme yok;
      önceki URL `URL.revokeObjectURL` ile bırakılır.
8. `phase = 'confirm'`. Tüm hatalar `error` alanına yazılır, uygulama çökmez.

**Yayınlama** (`publish`) sırası:

```ts
if (!appId) {
  appId = match.kind === 'existing'
    ? match.app.id
    : (await createPublishingApp({ categoryId, slug, title, shortDescription, description, featured: false })) // ok değilse hata
}
if (icon && !iconUploadedRef.current) {
  await uploadAsset({ appId, operationId: crypto.randomUUID(), kind: 'icon', file: iconFile, altText: '', position: 0 });
  iconUploadedRef.current = true;
}
const intent = await createUploadIntent({ appId, fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size });
await startUpload({ ...intent.data, mimeType: file.type || 'application/octet-stream' }, file, { onProgress, onError, onSuccess });
const digest = await hash(file);
const finalized = await finalizeUpload({
  appId, source: 'storage',
  packageName: manifest.packageName, versionName: manifest.versionName, versionCode: manifest.versionCode,
  changelog: `${manifest.versionName} sürümü.`, operationId: intent.data.operationId,
  size: file.size, sha256: digest,
  supportsMobile: true, supportsTv, accountRequirement: 'none',
});
const published = await publishVersion(finalized.data.id, crypto.randomUUID());
```

- Herhangi bir adım `ok: false` dönerse `new Error(result.error.message)` atılır.
- `crypto.randomUUID()` hem katalog operation id'si hem varlık isteği için kullanılır.
- `iconFile`: `new File([icon.bytes as unknown as ArrayBuffer], \`icon.${icon.mimeType === 'image/webp' ? 'webp' : 'png'}\`, { type: icon.mimeType })`.

**Hata ve telafi:**

- Bu çağrıda yeni uygulama oluşturulduysa ve sonraki adım hata verdiyse:
  `deleteApp(appId, title)` dene. Başarılıysa `createdAppId = null`,
  `iconUploadedRef.current = false`; hata mesajı göster, `phase = 'confirm'`.
  Silme başarısızsa uygulama id'si korunur, mesaja
  `Oluşturulan uygulama silinemedi; Uygulamalar sayfasından denetle.` eklenir.
- Mevcut uygulamaya yayında hata → uygulama silinmez; `confirm` ekranında yeniden dene.
- Önceki denemede oluşturulmuş `createdAppId` varsa yeniden dene aynı uygulamayı kullanır.

**Başarı:** `done = { appId, title, catalogWarning: Boolean(published.data?.catalogWarning) }`,
`phase = 'done'`.

### 11.3 Arayüz

- Bölüm: `<section aria-labelledby="quick-publish-heading">`, başlık
  `APK'yı bırak, gerisini sistem yapsın`.
- Dosya girişi: `label` metni **“APK dosyası”**, `accept=".apk"`.
- Okuma sırasında `<p role="status">APK okunuyor…</p>`.
- Onay ekranı:
  - Mevcut uygulama eşleşmesi: `<p><strong>{match.app.title}</strong> uygulamasına yeni sürüm eklenecek.</p>` + paket adı. Başlık/kategori/açıklama alanları **gösterilmez**.
  - Yeni uygulama: “Uygulama adı”, “Kategori” (zorunlu, `apps` kategorileri), “Kısa açıklama”, “Ayrıntılı açıklama”, `<details><summary>Gelişmiş</summary>` içinde “Slug”.
  - Her iki durumda: `Sürüm {versionName} ({versionCode})`, ikon önizlemesi
    (`<img alt="APK ikonu" />`) ya da `APK'da launcher ikonu bulunamadı; Uygulamayı yönet sayfasından elle yükleyebilirsin.`,
    “TV desteği” onay kutusu, **“Yayınla”** düğmesi (yeni uygulamada kategori seçilene
    kadar `disabled`), **“Vazgeç”** düğmesi.
- Yayın sırasında `<p role="status">Yayınlanıyor… %{progress}</p>`.
- Hata: `<p role="alert">{error}</p>`.
- Bitiş:
  - Başlık **“Yayın tamamlandı”**, `{title} kataloğa yayınlandı.`
  - `catalogWarning` ise `<div role="status">` içinde
    `Uygulama yayınlandı; statik katalog JSON güncellenemedi. Mobilde görünmesi için yeniden dene.`
    ve **“Katalog JSON'u yeniden dene”** düğmesi. Başarıda uyarı kaybolur; ikinci
    başarısızlıkta `error` alanına `Katalog JSON yine güncellenemedi. Ayarlar sayfasından elle deneyebilirsin.` yazılır.
  - **“Uygulamayı yönet”** bağlantısı `href={\`/apps/${done.appId}\`}`.
  - **“Yeni APK yayınla”** düğmesi durumu sıfırlar.

### 11.4 Testler

`quick-publish.test.tsx` enjekte edilen bağımlılıklarla:

1. APK seçilince onay ekranı gelir; başlık `Vizyona`, sürüm `1.2.3 (12)` görünür; kategori seçilmeden “Yayınla” pasif.
2. Yayında çağrı sırası: `createPublishingApp` → `uploadAsset` (icon) → `createUploadIntent` → `startUpload` → `finalizeUpload` → `publishVersion`.
3. Arşivli paket eşleşmesi `role="alert"` ile durur, onay ekranı açılmaz.
4. Mevcut aktif uygulama eşleşmesinde `createPublishingApp` çağrılmaz, `finalizeUpload` mevcut `appId` ile çağrılır.
5. `catalogWarning` varsa “Katalog JSON'u yeniden dene” görünür; tıklanınca `retryCatalog` çağrılır ve `true` dönünce uyarı kaybolur.
6. Yayın hatasında yeni uygulama `deleteApp` ile silinir ve hata gösterilir.

- [ ] Çalıştır: `npx vitest run src/features/publishing/quick-publish.test.tsx`

- [ ] Commit:

```bash
git add admin/src/features/publishing/quick-publish.tsx admin/src/features/publishing/quick-publish.test.tsx
git commit -m "feat(publishing): add one-screen quick apk publish flow"
```

---

## 12. Sayfaya bağla

**Dosyalar:** `admin/app/(dashboard)/publish/page.tsx`, `admin/src/features/publishing/publish-route.test.tsx`

- [ ] **12.1** Sayfada `PublishWizard`'ın **üstüne** ekle:

```tsx
import { QuickPublish } from '../../../src/features/publishing/quick-publish';

// ... mevcut importlar ve bileşen gövdesi aynen kalır ...

      <QuickPublish
        apps={apps}
        categories={categories.filter(category => category.isActive)}
      />
      <PublishWizard
        categories={categories.filter(category => category.isActive)}
        initialApp={selection.app}
        initialSelectionInvalid={selection.invalid}
      />
```

- [ ] **12.2** `publish-route.test.tsx`'e bir test ekle:
      `expect(screen.getByRole('heading', { name: "APK'yı bırak, gerisini sistem yapsın" })).toBeInTheDocument();`
      ve mevcut sihirbaz başlığının hâlâ render edildiğini doğrula.

- [ ] **12.3** Çalıştır: `npx vitest run src/features/publishing/publish-route.test.tsx`

- [ ] Commit:

```bash
git add "admin/app/(dashboard)/publish/page.tsx" admin/src/features/publishing/publish-route.test.tsx
git commit -m "feat(admin): show quick publish above the apk wizard"
```

---

## 13. Doğrulama

- [ ] Hedefli testler:

```bash
cd admin
npx vitest run \
  src/features/uploads/apk-manifest.test.ts \
  src/features/uploads/apk-icon.test.ts \
  src/features/publishing/apk-step.test.tsx \
  src/features/publishing/publish-wizard.test.tsx \
  src/features/publishing/quick-publish.test.tsx \
  src/features/publishing/quick-publish-model.test.ts \
  src/features/publishing/publish-route.test.tsx \
  src/features/publishing/publish-selection.test.ts \
  src/features/apps/publish-app-options.test.ts \
  src/features/catalog/static-json/config.test.ts \
  src/features/catalog/static-json/refresh.test.ts \
  src/features/catalog/static-json/build.test.ts \
  src/features/catalog/static-json/github.test.ts \
  src/features/catalog/catalog-json.test.ts \
  src/features/versions/version-service.test.ts
```

Beklenen: hepsi geçer; hiçbiri skip edilmemiş olur.

- [ ] Tam admin suite: `npx vitest run`
- [ ] `npx tsc --noEmit` — hata yok.
- [ ] `npx eslint` değişen dosyalar üzerinde — hata yok.
- [ ] `git status --porcelain` — plan dışı dosya değişmemiş olmalı; `lib/env.ts`
      değişiklikleri hâlâ yalnızca kullanıcıya ait (bizim commitlerimize girmemiş).

### Elle doğrulama (kod bittiğinde, ayrı adım)

1. `pnpm dev` (admin) → `/publish` → gerçek bir APK seç.
2. Onay ekranı doğru başlık/sürüm/ikon gösteriyor mu?
3. Yayınla → uygulama Uygulamalar listesinde aktif mi, sürüm yayında mı?
4. `SamulVanunu/cep-depo-catalog` son commit yeni `generatedAt` taşıyor mu?
5. Mobil uygulama / Expo web yeni uygulamayı gösteriyor mu?

---

## Bilinen sınırlar (bilinçli)

- Finalize aşaması mevcut uygulamada başarısız olursa aynı `versionCode` ile yeniden
  deneme `CONFLICT` verebilir; sihirbazda da aynı davranış var. Kullanıcı Uygulamayı
  yönet sayfasından taslağı görüp çözebilir.
- İkon seçimi `resources.arsc` çözmez; özel launcher adları bulunamazsa ikon alanı boş
  kalır ve yayın ikonsuz sürer.
- Statik JSON adımı env yoksa sessizce kapalıdır; Ayarlar sayfası elle yayını korur.
