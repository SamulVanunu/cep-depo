# Cep Depo Foundation and Public Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-file prototype with a tested Expo Router application and a secure Supabase catalog that anonymous users can browse, search, inspect, and download from.

**Architecture:** Keep the mobile project feature-oriented: routes compose focused feature components, repositories own Supabase queries, and pure mappers isolate generated database types from UI domain types. A canonical Supabase migration exposes only active apps and published versions through RLS; download history remains local and never claims that Android installed an APK.

**Tech Stack:** Expo SDK 57, React Native 0.83, React 19, Expo Router, TypeScript 5.9 strict mode, Supabase JS 2, TanStack Query 5, AsyncStorage, Jest/jest-expo, React Native Testing Library, Supabase CLI and pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-01-cep-depo-platform-design.md`

## Global Constraints

- Android package remains `com.cepdepo.app`; app name remains `Cep Depo`; URL scheme remains `cepdepo`.
- The interface is Turkish-first, portrait, dark, editorial and functional: charcoal background, warm off-white text and restrained lime accent.
- Bottom navigation contains exactly `Keşfet`, `Hesap`, `Bildirim` and `Hakkında`; no mobile admin route or admin code.
- Catalog browsing and APK downloading require no account.
- Only published versions of active apps are public; draft APKs must never be anonymously readable.
- `EXPO_PUBLIC_*` values are public bundle configuration. No secret/service-role key may enter the mobile project.
- A download records that the external APK URL opened; it does not claim that Android installed the APK.
- Use `npx expo install` for Expo/native packages so versions remain compatible with SDK 57.
- Preserve existing app icon/adaptive icon artwork unless a later approved design task replaces it.

## Review Focus

- Missing or malformed Supabase environment values must show a configuration error screen instead of constructing a placeholder client — pinned in Task 1.
- Anonymous reads must exclude archived apps, draft/withdrawn versions and all `apk-drafts` objects — pinned in Task 2.
- Empty queries, Turkish case/diacritics and rapid category changes must not leave stale or incorrect catalog results — pinned in Task 5.
- Malformed or outdated AsyncStorage download history must reset safely without crashing the app — pinned in Task 7.
- A failed URL open must not record a download; a metrics RPC failure after a successful open must not block the user or claim installation — pinned in Task 7.

## Delivery Split

This is plan 1 of 5 independently testable deliveries:

1. **This plan:** mobile foundation, public catalog, detail, download and local update label.
2. Accounts, profiles, reviews, ratings and reports.
3. Follows, in-app notifications and Expo push.
4. Independent Next.js admin, resumable APK upload and atomic publishing.
5. Package-signature checks, Play Integrity signals, production hardening and release verification.

## Planned File Structure

```text
app/
  _layout.tsx                         # Root providers, startup/config boundary
  (tabs)/_layout.tsx                  # Four-item bottom navigation
  (tabs)/index.tsx                    # Discover route
  (tabs)/account.tsx                  # Account placeholder until plan 2
  (tabs)/notifications.tsx            # Notification placeholder until plan 3
  (tabs)/about.tsx                    # About/legal/version route
  apps/[slug].tsx                     # Public app-detail route
src/
  app/AppProviders.tsx                # Query and safe-area providers
  components/ui/                      # Focused primitives and screen states
  features/bootstrap/BootstrapGate.tsx
  features/catalog/
    catalog.types.ts                  # UI-facing catalog contracts
    catalog.mapper.ts                 # Database row -> domain mapping
    catalog.repository.ts             # Supabase read queries
    catalog.queries.ts                # Query keys and hooks
    DiscoverScreen.tsx
    AppDetailScreen.tsx
  features/downloads/
    download-history.ts               # Version-code history parser/storage
    open-apk-download.ts               # Linking + metrics orchestration
  lib/env.ts                           # Validated public environment
  lib/supabase.ts                      # Single configured client
  theme/tokens.ts                      # Approved colors/type/spacing
  types/database.types.ts              # Generated, never hand-edited
tests/                                # Jest tests; never inside app/
supabase/
  config.toml
  migrations/20261001000100_catalog_foundation.sql
  seed.sql
  tests/catalog_rls.test.sql
  tests/catalog_functions.test.sql
```

Old `App.tsx`, `src/api.ts` and one-off SQL files are removed only in Task 8, after equivalent routes and migration tests pass.

---

### Task 1: Expo Router Foundation and Validated Configuration

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app.json`
- Modify: `tsconfig.json`
- Modify: `.env.example`
- Create: `eslint.config.js`
- Create: `jest.config.js`
- Create: `jest.setup.ts`
- Create: `app/_layout.tsx`
- Create: `app/(tabs)/_layout.tsx`
- Create: `app/(tabs)/index.tsx`
- Create: `app/(tabs)/account.tsx`
- Create: `app/(tabs)/notifications.tsx`
- Create: `app/(tabs)/about.tsx`
- Create: `src/app/AppProviders.tsx`
- Create: `src/lib/env.ts`
- Create: `src/components/ui/ConfigurationErrorScreen.tsx`
- Test: `tests/lib/env.test.ts`

**Interfaces:**
- Produces: `getPublicEnv(source?: Readonly<Record<string, string | undefined>>): { supabaseUrl: string; supabasePublishableKey: string }`
- Produces: Expo Router entry point and four named tab routes used by all later tasks.

- [ ] **Step 1: Install the SDK-compatible routing, query and test toolchain**

Set `package.json.main` to `expo-router/entry`. Use `npx expo install` for production native packages `expo-router`, `react-native-safe-area-context`, `react-native-screens`, `expo-linking`, `expo-constants`, `expo-status-bar`, `expo-splash-screen`, `expo-crypto`, `expo-clipboard` and `@react-native-async-storage/async-storage`. Install `@tanstack/react-query@^5`, `@supabase/supabase-js@^2` and `react-native-url-polyfill` as production dependencies. Use `npx expo install --dev` for `jest-expo`, `jest`, `@types/jest` and `@testing-library/react-native`; install `eslint`, `eslint-config-expo` and `supabase` as development dependencies. Add scripts `start`, `android`, `lint`, `typecheck`, `test`, `test:watch`, `db:start`, `db:reset`, `db:test` and `db:types`.

- [ ] **Step 2: Write failing environment tests**

```ts
describe('getPublicEnv', () => {
  it('returns a valid https Supabase URL and publishable key', () => {
    expect(getPublicEnv(validEnv)).toEqual({
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'sb_publishable_example',
    });
  });

  it.each([{}, { EXPO_PUBLIC_SUPABASE_URL: 'not-a-url' }])(
    'rejects missing or malformed public configuration',
    source => expect(() => getPublicEnv(source)).toThrow('Supabase yapılandırması eksik veya geçersiz.'),
  );
});
```

- [ ] **Step 3: Run the environment test and verify failure**

Run: `npm test -- tests/lib/env.test.ts`  
Expected: FAIL because `src/lib/env.ts` does not exist.

- [ ] **Step 4: Implement validated configuration and the Router shell**

Implement `getPublicEnv` without fallback credentials. `app/_layout.tsx` must catch configuration failure and render `ConfigurationErrorScreen`; otherwise it renders `AppProviders` and a root stack. Configure the four tabs with Turkish labels and accessible vector icons. Placeholder Account/Notification screens state that the feature is not yet available without pretending it works.

- [ ] **Step 5: Configure the app and tooling**

Keep package/scheme/icon/orientation values from Global Constraints, set `userInterfaceStyle: "dark"`, enable the Expo Router plugin and typed routes, retain the internal APK EAS release profile, and name the public Supabase entries `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.example`.

- [ ] **Step 6: Verify the foundation**

Run: `npm test -- tests/lib/env.test.ts`  
Expected: tests pass.

Run: `npm run typecheck`  
Expected: exits 0.

Run: `npm run lint`  
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json app.json tsconfig.json .env.example eslint.config.js jest.config.js jest.setup.ts app src/app src/lib/env.ts src/components/ui/ConfigurationErrorScreen.tsx tests/lib/env.test.ts
git commit -m "chore: establish Expo Router foundation"
```

---

### Task 2: Catalog Schema, Storage Boundaries and Anonymous RLS

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/20261001000100_catalog_foundation.sql`
- Create: `supabase/seed.sql`
- Create: `supabase/tests/catalog_rls.test.sql`
- Create: `supabase/tests/catalog_functions.test.sql`

**Interfaces:**
- Produces tables: `user_roles`, `categories`, `apps`, `app_versions`, `app_screenshots`, `download_events`.
- Produces view: `catalog_app_cards` with `app_id`, `slug`, `title`, `short_description`, `icon_path`, `category_id`, `category_name`, `category_slug`, `featured`, `download_count`, `version_id`, `version_name`, `version_code`, `version_changelog`, `apk_path`, `apk_size_bytes`, `sha256`, `published_at`.
- Produces RPC: `search_catalog(p_query text, p_category_slug text, p_sort text) returns setof catalog_app_cards`; accepted sorts are `popular` and `newest`, and search is Turkish-case/diacritic tolerant through `unaccent(lower(...))`.
- Produces RPC: `record_download(p_version_id uuid, p_installation_id uuid) returns boolean`; `true` means a new unique event was counted.
- Produces buckets: private `apk-drafts`; public-read `apks`, `app-assets`; private-by-default `avatars`.

- [ ] **Step 1: Initialize local Supabase configuration without touching a remote project**

Run: `npx supabase init`  
Expected: local `supabase/config.toml` exists; no `supabase link`, `db push` or remote reset is performed.

- [ ] **Step 2: Write failing pgTAP policy tests**

`catalog_rls.test.sql` must assert:

```sql
-- anon can see an active app and its published version
-- anon cannot see an archived app
-- anon cannot see draft or withdrawn versions
-- anon can select an object in apks/app-assets
-- anon cannot select or insert an object in apk-drafts
-- authenticated non-admin cannot insert/update/delete catalog records
```

`catalog_functions.test.sql` must assert:

```sql
-- catalog_app_cards returns only the highest published version_code
-- search_catalog('IPTV', null, 'popular') matches a title containing 'İptv'
-- search_catalog('eglence', 'eglence', 'newest') matches the 'Eğlence' category and orders by published_at desc
-- search_catalog rejects sort values other than popular/newest
-- record_download rejects a nonexistent/unpublished version
-- repeated (version_id, installation_id) returns false and increments count once
-- a new installation UUID returns true and increments count
```

- [ ] **Step 3: Run database tests and verify failure**

Run: `npm run db:start`  
Expected: local Supabase starts.

Run: `npm run db:test`  
Expected: FAIL because catalog relations/functions do not exist.

- [ ] **Step 4: Implement the catalog migration**

Use UUID primary keys, `citext` where case-insensitive uniqueness is required, the `unaccent` extension for catalog search, timestamps with time zone, and enums/check constraints for roles/statuses. `version_code` is positive and unique per app. Published APK paths match `apps/<app_uuid>/versions/<version_uuid>.apk`. Enable RLS on every table. Use a `security invoker` view, a read-only invoker-rights `search_catalog` function, and a `security definer` `record_download` function with fixed `search_path`, explicit grants and validation of active app/published version.

- [ ] **Step 5: Implement bucket policies and representative seed data**

Seed at least three categories, two active apps with published versions/screenshots, one archived app and one draft version. Use deterministic UUIDs so Jest/manual fixtures can reference them. Storage writes remain denied to anon/authenticated non-admin; admin upload policies may be completed in plan 4, but no permissive placeholder policy is allowed.

- [ ] **Step 6: Verify migration and RLS from a clean database**

Run: `npm run db:reset`  
Expected: database resets and applies the migration/seed from scratch.

Run: `npm run db:test`  
Expected: all pgTAP files report `Result: PASS`.

- [ ] **Step 7: Commit**

```bash
git add supabase/config.toml supabase/migrations/20261001000100_catalog_foundation.sql supabase/seed.sql supabase/tests
git commit -m "feat: add secure public catalog schema"
```

---

### Task 3: Typed Supabase Client and Catalog Repository

**Files:**
- Create: `src/types/database.types.ts`
- Create: `src/lib/supabase.ts`
- Create: `src/features/catalog/catalog.types.ts`
- Create: `src/features/catalog/catalog.mapper.ts`
- Create: `src/features/catalog/catalog.repository.ts`
- Create: `src/features/catalog/catalog.queries.ts`
- Test: `tests/features/catalog/catalog.mapper.test.ts`
- Test: `tests/features/catalog/catalog.repository.test.ts`

**Interfaces:**
- Consumes: `getPublicEnv` from Task 1; catalog view/tables from Task 2.
- Produces the following domain contracts:

```ts
type Category = { id: string; slug: string; name: string };
type CatalogVersion = {
  id: string; name: string; code: number; changelog: string;
  apkPath: string; apkSizeBytes: number; sha256: string; publishedAt: string;
};
type CatalogCard = {
  id: string; slug: string; title: string; shortDescription: string;
  iconPath: string | null; category: Category; featured: boolean;
  downloadCount: number; currentVersion: CatalogVersion;
};
type CatalogApp = CatalogCard & {
  description: string;
  screenshots: Array<{ id: string; path: string; altText: string; position: number }>;
  versions: CatalogVersion[];
};
type CatalogFilters = {
  query: string; categorySlug: string | null; sort: 'popular' | 'newest';
};
```

- Produces: `createCatalogRepository(client): CatalogRepository`.
- Produces repository methods: `listCategories(): Promise<Category[]>`, `listApps(filters: CatalogFilters): Promise<CatalogCard[]>`, `getAppBySlug(slug: string): Promise<CatalogApp | null>`, `recordDownload(versionId: string, installationId: string): Promise<boolean>`.
- Produces hooks: `useCategories()`, `useCatalogApps(filters)`, `useCatalogApp(slug)` with stable query keys.

- [ ] **Step 1: Generate database types from the reset local schema**

Run: `npm run db:types`  
Expected: `src/types/database.types.ts` is generated by `npx supabase gen types typescript --local`; do not hand-edit it.

- [ ] **Step 2: Write failing mapper and repository tests**

```ts
it('maps snake_case card rows to immutable CatalogCard values', () => {
  expect(mapCatalogCard(cardRow)).toMatchObject({
    slug: 'cep-iptv',
    category: { slug: 'eglence', name: 'Eğlence' },
    currentVersion: { code: 12, name: '1.2' },
  });
});

it('normalizes blank filters and delegates sorting to search_catalog', async () => {
  await repository.listApps({ query: '   ', categorySlug: null, sort: 'popular' });
  expect(mockRpc).toHaveBeenCalledWith('search_catalog', {
    p_query: '', p_category_slug: null, p_sort: 'popular',
  });
});

it('returns null only for the PostgREST no-row result and throws other errors', async () => {
  await expect(notFoundRepository.getAppBySlug('missing')).resolves.toBeNull();
  await expect(failingRepository.getAppBySlug('broken')).rejects.toThrow('catalog unavailable');
});
```

- [ ] **Step 3: Run repository tests and verify failure**

Run: `npm test -- tests/features/catalog/catalog.mapper.test.ts tests/features/catalog/catalog.repository.test.ts`  
Expected: FAIL because catalog modules do not exist.

- [ ] **Step 4: Implement domain mapping, repository and query hooks**

Normalize blank query/category values before invoking `search_catalog`; do not compose raw PostgREST filter expressions from user text. Detail reads include only published versions ordered by `version_code desc` and screenshots ordered by `position asc`.

- [ ] **Step 5: Implement one configured Supabase client**

Use generated `Database` types, AsyncStorage auth persistence, token auto-refresh and `detectSessionInUrl: false`. Client creation consumes only validated env and exports neither service-role logic nor fallback credentials.

- [ ] **Step 6: Verify repository behavior and types**

Run: `npm test -- tests/features/catalog`  
Expected: all tests pass.

Run: `npm run typecheck`  
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/types src/lib/supabase.ts src/features/catalog tests/features/catalog
git commit -m "feat: add typed catalog data access"
```

---

### Task 4: Design Tokens and Reusable UI States

**Files:**
- Create: `src/theme/tokens.ts`
- Create: `src/components/ui/AppText.tsx`
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/AppIcon.tsx`
- Create: `src/components/ui/ScreenState.tsx`
- Create: `src/components/ui/Skeleton.tsx`
- Create: `src/components/ui/CategoryChip.tsx`
- Create: `src/components/ui/AppCard.tsx`
- Test: `tests/components/ui/Button.test.tsx`
- Test: `tests/components/ui/ScreenState.test.tsx`
- Test: `tests/components/ui/AppCard.test.tsx`

**Interfaces:**
- Consumes: `CatalogCard` from Task 3.
- Produces: theme constants `colors`, `spacing`, `radii`, `typography`, `motion`.
- Produces: UI primitives with explicit loading, disabled, accessibility and retry contracts.

- [ ] **Step 1: Write failing component behavior tests**

```tsx
it('prevents duplicate presses while Button is loading', () => {
  fireEvent.press(rendered.getByRole('button'));
  expect(onPress).not.toHaveBeenCalled();
});

it('renders an error state with a named retry action', () => {
  expect(rendered.getByText('Uygulamalar yüklenemedi.')).toBeTruthy();
  fireEvent.press(rendered.getByRole('button', { name: 'Tekrar dene' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('announces app title, category and version without relying on color', () => {
  expect(card.getByLabelText('Cep IPTV, Eğlence, sürüm 1.2')).toBeTruthy();
});
```

- [ ] **Step 2: Run UI tests and verify failure**

Run: `npm test -- tests/components/ui`  
Expected: FAIL because the UI components do not exist.

- [ ] **Step 3: Implement approved theme tokens and primitives**

Use `#111315` for the main background, `#F5F3ED` for primary text and `#C8F36A` for the lime accent. Keep minimum touch targets at 44x44, support font scaling, attach roles/labels, and use built-in React Native animation only where it communicates state.

- [ ] **Step 4: Verify UI behavior**

Run: `npm test -- tests/components/ui`  
Expected: all tests pass.

Run: `npm run typecheck`  
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/theme src/components/ui tests/components/ui
git commit -m "feat: add Cep Depo design primitives"
```

---

### Task 5: Discover Screen, Search, Categories and Popular Apps

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Create: `src/features/catalog/DiscoverScreen.tsx`
- Create: `src/features/catalog/useCatalogFilters.ts`
- Test: `tests/features/catalog/useCatalogFilters.test.ts`
- Test: `tests/features/catalog/DiscoverScreen.test.tsx`

**Interfaces:**
- Consumes: catalog hooks from Task 3 and UI components from Task 4.
- Produces: `useCatalogFilters()` with `{ query, setQuery, categorySlug, setCategorySlug, sort, setSort }`.
- Produces: Discover route navigation to `/apps/[slug]`.

- [ ] **Step 1: Write failing filter and screen tests**

```ts
it('debounces search by 250 ms and preserves Turkish text', () => {
  result.current.setQuery('İpTv');
  jest.advanceTimersByTime(249);
  expect(result.current.debouncedQuery).toBe('');
  jest.advanceTimersByTime(1);
  expect(result.current.debouncedQuery).toBe('İpTv');
});
```

```tsx
it.each([
  ['loading', 'Katalog yükleniyor'],
  ['empty-store', 'Mağaza henüz boş.'],
  ['empty-search', 'Sonuç bulunamadı.'],
  ['error', 'Uygulamalar yüklenemedi.'],
])('renders the %s state without stale cards', (state, expectedText) => {
  renderDiscover(state);
  expect(screen.getByText(expectedText)).toBeTruthy();
  expect(screen.queryByTestId('catalog-list')).toBeNull();
});

it('discards results from the previous category after a rapid category change', async () => {
  // Resolve the second request before the first; only second-category cards remain.
  expect(screen.queryByText('Eski kategori uygulaması')).toBeNull();
  expect(screen.getByText('Yeni kategori uygulaması')).toBeTruthy();
});
```

- [ ] **Step 2: Run Discover tests and verify failure**

Run: `npm test -- tests/features/catalog/useCatalogFilters.test.ts tests/features/catalog/DiscoverScreen.test.tsx`  
Expected: FAIL because Discover modules do not exist.

- [ ] **Step 3: Implement filter state and query cancellation**

Use a 250 ms search debounce. Query keys include normalized query/category/sort. TanStack Query must cancel or ignore superseded requests so late results cannot overwrite the latest selection.

- [ ] **Step 4: Implement the Discover composition**

Render the approved wordmark/header, hero, search, horizontally scrollable categories, featured card and app list. `Popüler` sorts by download count; `Yeni` sorts by published time. Pull-to-refresh invalidates active catalog/category queries. Search and category controls have Turkish accessibility labels.

- [ ] **Step 5: Verify Discover**

Run: `npm test -- tests/features/catalog`  
Expected: all tests pass.

Run: `npm run typecheck`  
Expected: exits 0.

Run: `npm run lint`  
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add app/\(tabs\)/index.tsx src/features/catalog/DiscoverScreen.tsx src/features/catalog/useCatalogFilters.ts tests/features/catalog
git commit -m "feat: build public discovery experience"
```

---

### Task 6: App Detail, Screenshot Gallery and Version History

**Files:**
- Create: `app/apps/[slug].tsx`
- Create: `src/features/catalog/AppDetailScreen.tsx`
- Create: `src/features/catalog/ScreenshotGallery.tsx`
- Create: `src/features/catalog/VersionHistory.tsx`
- Test: `tests/features/catalog/AppDetailScreen.test.tsx`
- Test: `tests/features/catalog/ScreenshotGallery.test.tsx`

**Interfaces:**
- Consumes: `useCatalogApp(slug)` from Task 3 and UI components from Task 4.
- Produces: detail route with a download callback slot consumed by Task 7.

- [ ] **Step 1: Write failing detail tests**

```tsx
it('renders icon, description, ordered screenshots and published versions only', () => {
  expect(screen.getByRole('heading', { name: 'Cep IPTV' })).toBeTruthy();
  expect(screen.getAllByLabelText(/Ekran görüntüsü/)).toHaveLength(3);
  expect(screen.getByText('1.2 · Güncel sürüm')).toBeTruthy();
  expect(screen.queryByText('1.3-beta')).toBeNull();
});

it('uses a deterministic fallback when icon or screenshots are absent', () => {
  expect(screen.getByLabelText('Cep IPTV için varsayılan ikon')).toBeTruthy();
  expect(screen.getByText('Henüz ekran görüntüsü eklenmemiş.')).toBeTruthy();
});

it('shows retry, not a blank page, when the detail request fails', () => {
  expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeTruthy();
});
```

- [ ] **Step 2: Run detail tests and verify failure**

Run: `npm test -- tests/features/catalog/AppDetailScreen.test.tsx tests/features/catalog/ScreenshotGallery.test.tsx`  
Expected: FAIL because detail modules do not exist.

- [ ] **Step 3: Implement the detail route and screen states**

Validate `slug` as one non-empty string before querying. Render loading, not-found, error and success states. Success shows current version metadata, SHA-256 with copy action, screenshot gallery, description and descending published version history. Reserve the follow/review/report sections for later plans without disabled fake controls.

- [ ] **Step 4: Verify detail behavior**

Run: `npm test -- tests/features/catalog`  
Expected: all tests pass.

Run: `npm run typecheck`  
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add app/apps src/features/catalog/AppDetailScreen.tsx src/features/catalog/ScreenshotGallery.tsx src/features/catalog/VersionHistory.tsx tests/features/catalog
git commit -m "feat: add public app detail and versions"
```

---

### Task 7: APK Download, Local Version History and Update Label

**Files:**
- Create: `src/features/downloads/download-history.ts`
- Create: `src/features/downloads/open-apk-download.ts`
- Create: `src/features/downloads/useDownloadedVersion.ts`
- Modify: `src/features/catalog/AppDetailScreen.tsx`
- Test: `tests/features/downloads/download-history.test.ts`
- Test: `tests/features/downloads/open-apk-download.test.ts`
- Modify: `tests/features/catalog/AppDetailScreen.test.tsx`

**Interfaces:**
- Consumes: `recordDownload(versionId, installationId)` from Task 3.
- Produces: `readDownloadHistory(storage?): Promise<DownloadHistory>`.
- Produces: `markVersionDownloaded(appId: string, versionCode: number, storage?): Promise<void>`.
- Produces: `getOrCreateInstallationId(storage?): Promise<string>`.
- Produces: `openApkDownload(input: DownloadInput, dependencies: DownloadDependencies): Promise<{ metricsRecorded: boolean }>`.
- Produces: `getDownloadAction(latestCode: number, downloadedCode?: number): 'download' | 'update'`.

- [ ] **Step 1: Write failing history and orchestration tests**

```ts
it.each(['{bad json', '[]', '{"schemaVersion":99}'])(
  'resets malformed or unsupported history without throwing: %s',
  async stored => expect(await readFrom(stored)).toEqual({ schemaVersion: 1, apps: {} }),
);

it('returns update only when latest version_code is greater than locally opened code', () => {
  expect(getDownloadAction(12, 11)).toBe('update');
  expect(getDownloadAction(12, 12)).toBe('download');
});

it('does not write history or metrics when Linking.openURL rejects', async () => {
  await expect(openWithRejectedLink()).rejects.toThrow();
  expect(markVersionDownloaded).not.toHaveBeenCalled();
  expect(recordDownload).not.toHaveBeenCalled();
});

it('keeps a successful open and local history when the metrics RPC fails', async () => {
  await expect(openWithRejectedMetrics()).resolves.toEqual({ metricsRecorded: false });
  expect(markVersionDownloaded).toHaveBeenCalledWith(APP_ID, 12);
});
```

- [ ] **Step 2: Run download tests and verify failure**

Run: `npm test -- tests/features/downloads`  
Expected: FAIL because download modules do not exist.

- [ ] **Step 3: Implement versioned local history and installation UUID**

Use separate AsyncStorage keys `cep-depo:download-history:v1` and `cep-depo:installation-id:v1`. Accept only finite positive integer version codes and plain-object app maps. Corrupt values reset in memory and storage. Generate installation UUID once with a platform-supported secure UUID source.

- [ ] **Step 4: Implement URL opening and metrics isolation**

Build the URL from the public `apks` bucket path; reject any non-HTTPS URL. Call `Linking.openURL` first. Only after it resolves, persist local history and call `recordDownload`; metrics failure returns `false` and logs a redacted warning but does not fail the user action.

- [ ] **Step 5: Wire the detail button**

Show `APK İNDİR` when no older local version exists and `GÜNCELLE` only when the latest code is greater. Add explanatory text: `İndirme, kurulumun tamamlandığı anlamına gelmez.` Disable duplicate presses while opening. Surface URL-open failures in a Turkish alert with retry.

- [ ] **Step 6: Verify download behavior**

Run: `npm test -- tests/features/downloads tests/features/catalog/AppDetailScreen.test.tsx`  
Expected: all tests pass.

Run: `npm run typecheck`  
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/features/downloads src/features/catalog/AppDetailScreen.tsx tests/features/downloads tests/features/catalog/AppDetailScreen.test.tsx
git commit -m "feat: add safe APK download tracking"
```

---

### Task 8: Startup Experience, About Screen, Cleanup and Phase Verification

**Files:**
- Create: `src/features/bootstrap/BootstrapGate.tsx`
- Create: `src/features/bootstrap/LogoMark.tsx`
- Modify: `app/_layout.tsx`
- Modify: `app/(tabs)/about.tsx`
- Create: `src/lib/public-links.ts`
- Modify: `README.md`
- Delete after verification: `App.tsx`
- Delete after verification: `src/api.ts`
- Delete after verification: `supabase/schema.sql`
- Delete after verification: `supabase/link_source_migration.sql`
- Delete after verification: `supabase/release_events_migration.sql`
- Delete after verification: `assets/admin-off.png`
- Delete after verification: `assets/admin-on.png`
- Test: `tests/features/bootstrap/BootstrapGate.test.tsx`
- Test: `tests/routes/about.test.tsx`

**Interfaces:**
- Consumes: validated configuration and Router shell from Task 1.
- Produces: a startup gate that never adds artificial delay and respects reduced-motion settings.

- [ ] **Step 1: Write failing startup and About tests**

```tsx
it('keeps the logo visible only while required startup work is pending', async () => {
  expect(screen.getByLabelText('Cep Depo açılıyor')).toBeTruthy();
  resolveStartup();
  await waitFor(() => expect(screen.queryByLabelText('Cep Depo açılıyor')).toBeNull());
});

it('skips motion when reduce motion is enabled', async () => {
  mockReduceMotion(true);
  expect(startAnimation).not.toHaveBeenCalled();
});

it('shows app version, privacy, terms, contact and open-source entries', () => {
  expect(screen.getByText(/Sürüm 0.1.0/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Gizlilik' })).toBeTruthy();
});
```

- [ ] **Step 2: Run startup/About tests and verify failure**

Run: `npm test -- tests/features/bootstrap/BootstrapGate.test.tsx tests/routes/about.test.tsx`  
Expected: FAIL because startup/About implementations are incomplete.

- [ ] **Step 3: Implement the startup gate and About content**

Use the approved wordmark and a short opacity/scale transition driven by actual configuration/session-cache startup work. Do not sleep or impose a minimum duration. Read app version from Expo Constants. `src/lib/public-links.ts` reads `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL` and `EXPO_PUBLIC_CONTACT_URL`; privacy/terms accept HTTPS only and contact accepts HTTPS or `mailto:`. Missing values render `Yapılandırılmadı` without crashing; unsupported schemes are never opened. Add these non-secret keys to `.env.example`.

- [ ] **Step 4: Rewrite setup documentation**

Document Node 22, npm 10, Docker/local Supabase prerequisites, `npm install`, local DB commands, type generation, `.env` setup, tests, Expo development run and EAS APK build. State explicitly that push/auth/admin are subsequent delivery plans and that anon/publishable keys are public while service-role keys are forbidden in the app.

- [ ] **Step 5: Verify replacement before removing legacy files**

Run: `npm test -- --runInBand`  
Expected: all Jest tests pass and the Router app covers catalog/detail/download/About behavior.

Run: `npm run db:reset`  
Expected: clean reset succeeds.

Run: `npm run db:test`  
Expected: all pgTAP tests pass.

Run: `npm run typecheck`  
Expected: exits 0.

Run: `npm run lint`  
Expected: exits 0.

- [ ] **Step 6: Remove superseded single-file code and one-off SQL**

Delete only the files listed under “Delete after verification.” Keep app/adaptive icons and non-admin navigation artwork until a later asset cleanup proves they are unused.

- [ ] **Step 7: Run final phase checks**

Run: `npx expo export --platform android`  
Expected: Android export completes with no missing route/asset/config error.

Run: `npm test -- --runInBand`  
Expected: all Jest tests pass.

Run: `npm run db:test`  
Expected: all pgTAP tests pass.

Run: `npm run typecheck`  
Expected: exits 0.

Run: `npm run lint`  
Expected: exits 0.

Run: `git status --short`  
Expected: only intentional files for this task are modified/deleted; `.env`, APKs, credentials and `.superpowers/` are absent.

- [ ] **Step 8: Commit**

```bash
git add app src README.md tests package.json package-lock.json app.json tsconfig.json supabase assets
git commit -m "feat: complete public catalog foundation"
```

## Phase Acceptance Checklist

- Anonymous user can launch the app, browse seeded categories/apps, search, sort and open a detail page.
- Archived apps and draft/withdrawn versions are absent from both API results and UI.
- Public detail shows screenshots, release metadata, SHA-256 and version history.
- APK button opens only an HTTPS public Storage URL; failed opens do not alter history.
- A later published version produces `GÜNCELLE` on the same device based on local download history, with no installation claim.
- Four-tab shell and About screen match approved dark editorial direction; account/notification tabs do not pretend unfinished functions work.
- Clean database reset, pgTAP, Jest, typecheck, lint and Android export all pass.
