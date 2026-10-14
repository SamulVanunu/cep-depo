# External APK and Admin Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver mobile `0.3.1` with verified Storage/external HTTPS APK downloads while fixing stale admin visuals and making every explicit publication atomically activate its application.

**Architecture:** Extend `app_versions` with an explicit source discriminant and mutually exclusive Storage-path/external-URL fields, then carry the same discriminated union through admin review, catalog mapping, and mobile download code. External drafts use a locally selected APK for magic, size, and SHA-256 without uploading its body; publication is protected by a server-only rollout flag. Existing image mutations retain `revalidatePath` and add client route refresh so open pages consume the fresh RSC payload.

**Tech Stack:** PostgreSQL/Supabase migrations and pgTAP, Next.js 16 App Router, React 19, Zod, Vitest, Playwright, Expo SDK 57, React Native 0.86, TypeScript, Jest, EAS Build

**Spec:** `docs/superpowers/specs/2026-10-14-external-apk-admin-reliability-design.md`

## Global Constraints

- Keep Expo version exactly `0.3.1` and Android `versionCode` exactly `4`.
- Preserve commits `f35f35e` (cancellation hardening) and `f106029` (release identity); do not redo or revert them.
- APK source is explicit: `storage` uses a canonical Storage path; `external` uses a direct public HTTPS URL. Never infer source from string shape.
- External URLs must have HTTPS, a public host, no credentials, no query, and no fragment; reject localhost and literal private/link-local/loopback IPv4 or IPv6 addresses.
- Mega, TeraBox, HTML download pages, authenticated links, signed query URLs, and server-side APK proxying are out of scope.
- External metadata comes from a locally selected APK: positive byte size, ZIP/APK magic `50 4b 03 04`, and lowercase SHA-256. Admin cannot type size or hash manually.
- Storage upload guidance switches at exactly `50_000_000` bytes; the existing server/bucket ceiling remains unchanged.
- Every publish entry point uses `admin_publish_version_and_activate_app`; upload/finalize alone never publishes.
- `EXTERNAL_APK_PUBLISHING_ENABLED` is server-only, defaults to `false`, and does not block Storage publication or external draft creation.
- Do not add OTA, TV, push notification, support-message, or ADB work.
- Hosted migration, admin deployment, EAS build, artifact distribution, and production rollout enablement each require a separate explicit approval.
- Never commit APK/AAB/signing material, secrets, or `.memory/CURRENT.md` without explicit approval.

## Review Focus

- External URL with credentials, query/fragment, a single-label/private suffix host, private IPv4, loopback/link-local/ULA IPv6, or IPv4-mapped private IPv6 must fail before a draft or native task is created.
- A file named `.apk` with an accepted MIME type but wrong first four bytes must fail before hash finalization or draft creation.
- With external rollout disabled, an external draft must remain retryable while Storage publication continues to work.
- Publishing an existing archived app—not only a wizard-created app—must atomically produce an active app and published version.
- Successful icon/screenshot mutations must update the open admin route once without duplicate records, losing form state unexpectedly, or requiring browser reload.

---

### Task 1: Add the database APK source contract

**Files:**
- Create via CLI: `supabase/migrations/*_external_apk_sources.sql`
- Create: `supabase/tests/external_apk_sources.test.sql`
- Modify: `supabase/tests/admin_panel_transitions.test.sql`
- Modify generated: `src/types/database.types.ts`
- Modify generated: `admin/src/types/database.types.ts`

**Interfaces:**
- Produces enum: `public.apk_download_source = ('storage', 'external')`.
- Produces columns: `app_versions.download_source`, nullable `apk_path`, nullable `apk_url`.
- Produces catalog fields: `download_source`, `apk_path`, `apk_url` on `catalog_app_cards` and `search_catalog` rows.
- Preserves RPC: `admin_publish_version_and_activate_app(uuid, uuid)`; updates its delegated `admin_publish_version` validation for both source kinds.

- [ ] **Step 1: Write failing pgTAP coverage**

Create tests that assert:

- Existing fixture versions read as `storage` with non-null `apk_path` and null `apk_url`.
- Valid external draft accepts `download_source = 'external'`, null path, HTTPS URL, size, and hash.
- Mixed/missing source fields, HTTP URLs, credentials, query strings, and fragments raise `23514`.
- Anonymous catalog rows expose the source plus only its matching reference.
- `admin_publish_version_and_activate_app` publishes an external draft without a Storage object and activates an archived app.
- Storage publication still rejects a missing/mismatched canonical object.
- Publication audit metadata contains `download_source` but no full external URL.

Extend `admin_panel_transitions.test.sql` so the existing archived-app case also covers an existing app selected through the normal publish path, not only the quick-create fixture.

- [ ] **Step 2: Run database tests to verify RED**

Run:

```bash
npm run db:reset
npm run db:test
```

Expected: reset may succeed on the old schema, but the new external-source tests fail because enum/columns/constraints and external publication support do not exist.

- [ ] **Step 3: Generate and implement the migration**

Run `npx supabase migration new external_apk_sources` and use the emitted filename. Implement:

- `public.apk_download_source`.
- `download_source not null default 'storage'`, `apk_url`, and nullable `apk_path`.
- Named source-consistency and external-URL shape/length constraints; preserve canonical Storage path validation.
- A recreated/appended `catalog_app_cards` contract containing the three source fields without silently reordering existing public columns.
- `admin_publish_version` source branching: verify `storage.objects` only for Storage; accept constraint-valid external metadata without fetching the URL; include source in audit metadata.
- Grants and function security equivalent to the existing definitions.

- [ ] **Step 4: Regenerate both database type files**

Generate once from local Supabase and write identical output to:

```text
src/types/database.types.ts
admin/src/types/database.types.ts
```

Do not hand-edit generated type bodies.

- [ ] **Step 5: Run database verification to verify GREEN**

Run:

```bash
npm run db:reset
npm run db:test
npx supabase db lint --local --level warning
```

Expected: all pgTAP files pass and database lint reports no issue.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/tests src/types/database.types.ts admin/src/types/database.types.ts
git commit -m "feat: add external APK source schema"
```

### Task 2: Validate external URLs and create external drafts

**Files:**
- Create: `admin/src/features/uploads/external-apk.ts`
- Create: `admin/src/features/uploads/external-apk.test.ts`
- Create: `admin/src/features/uploads/external-draft-actions.ts`
- Create: `admin/src/features/uploads/external-draft-actions.test.ts`
- Modify: `admin/src/features/uploads/upload-schema.ts`

**Interfaces:**
- Produces constant: `HOSTED_STORAGE_MAX_BYTES = 50_000_000`.
- Produces: `parseExternalApkUrl(raw: string): Readonly<{ url: string; hostname: string }>`.
- Produces: `verifyLocalApkMagic(file: Blob): Promise<void>`.
- Produces: `createExternalDraft(raw, dependencies): Promise<ActionResult<{ id: string; status: 'draft'; hostname: string }>>` and `createExternalDraftAction`.
- Consumes Task 1's `download_source = 'external'`, nullable `apk_path`, and `apk_url` insert contract.

- [ ] **Step 1: Write failing URL and magic tests**

Test one accepted literal such as `https://downloads.example.com/releases/app.apk`, normalization of hostname casing, and rejection of:

- `http:` and protocol-relative input.
- Username/password.
- Query and fragment.
- `localhost`, `.localhost`, single-label hosts, `.local`, `.internal`, `.lan`, `127.0.0.1`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `0/8`, and `100.64/10` literals.
- `::`, `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped private IPv6 literals.

Test `verifyLocalApkMagic` with exact `50 4b 03 04`, a short file, and a wrong signature. The production mutation caught by these tests is accepting a URL/file that cannot safely become an external APK draft.

- [ ] **Step 2: Write failing external draft action tests**

Assert authorization occurs before validation/database work, generated IDs are server-owned, the insert contains null `apk_path`, normalized `apk_url`, exact local size/hash, and `download_source: 'external'`. Audit metadata must equal source/hostname/version code and must not contain the full URL.

Assert invalid UUID, filename, URL, size, hash, or duplicate version returns sanitized `ActionResult` and does not insert.

- [ ] **Step 3: Run focused tests to verify RED**

Run:

```bash
cd admin && npm test -- src/features/uploads/external-apk.test.ts src/features/uploads/external-draft-actions.test.ts
```

Expected: FAIL because the modules and action do not exist.

- [ ] **Step 4: Implement validation and the server action**

Keep URL parsing and literal-address classification in `external-apk.ts`. Use `URL`, not regex alone, then apply the explicit host/query/credential checks. `verifyLocalApkMagic` reads only `file.slice(0, 4)`.

Implement the external draft action with the same `requireAdmin(..., { mutation: true })`, admin client, audit, error sanitization, version constraints, and revalidation patterns used by Storage drafts. Do not fetch the external URL and do not accept manually entered size/hash.

- [ ] **Step 5: Run focused tests to verify GREEN**

Run the Step 3 command.

Expected: both files pass, including every Review Focus URL class.

- [ ] **Step 6: Commit**

```bash
git add admin/src/features/uploads
git commit -m "feat: create verified external APK drafts"
```

### Task 3: Add Storage/external modes to the publishing wizard

**Files:**
- Modify: `admin/src/features/publishing/apk-step.tsx`
- Modify: `admin/src/features/publishing/apk-step.test.tsx`
- Modify: `admin/src/features/publishing/publish-types.ts`
- Modify: `admin/src/features/publishing/review-step.tsx`
- Modify: `admin/src/features/publishing/publish-wizard.tsx`
- Modify: `admin/src/features/publishing/publish-wizard.test.tsx`

**Interfaces:**
- Consumes Task 2's `HOSTED_STORAGE_MAX_BYTES`, `parseExternalApkUrl`, `verifyLocalApkMagic`, and `createExternalDraftAction`.
- Produces `PublishReview.source` as `{ kind: 'storage' } | { kind: 'external'; hostname: string }`.
- Extends `ApkStepDependencies` with `createExternalDraft: typeof createExternalDraftAction`.
- Preserves explicit review and `Yayınla`; neither source auto-publishes.

- [ ] **Step 1: Add failing component tests for source selection**

Test an accessible radio/group choice between `APK dosyası yükle` and `HTTPS APK linki kullan`. Assert:

- Storage mode preserves current TUS behavior.
- A `50_000_001` byte file never requests an upload intent and shows a button/message that switches to external mode.
- External mode requires HTTPS URL and local APK, verifies magic before hashing, hashes with progress, calls `createExternalDraft` once, and never calls TUS dependencies.
- Wrong magic prevents hash/draft creation.
- Cancellation during external hashing returns to a retryable state without creating a draft.
- External review shows `Harici HTTPS` and only the normalized hostname, never the complete URL.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
cd admin && npm test -- src/features/publishing/apk-step.test.tsx src/features/publishing/publish-wizard.test.tsx
```

Expected: FAIL because source selection, threshold guidance, external dependency, and review source do not exist.

- [ ] **Step 3: Implement the two-mode state machine**

Add source state while sharing version/changelog/local-file fields. Storage mode retains upload/cancel/orphan semantics. External mode performs URL parse → magic check → chunked hash → external draft action. Keep duplicate-submit prevention and error focus behavior for both modes.

Update `ReviewStep` to show source and hostname. Do not render or log the complete URL.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run the Step 2 command.

Expected: all publishing component tests pass with no act/accessibility warnings.

- [ ] **Step 5: Commit**

```bash
git add admin/src/features/publishing
git commit -m "feat: add external APK publishing mode"
```

### Task 4: Gate external publication and always activate apps

**Files:**
- Modify: `admin/src/lib/env.ts`
- Modify: `admin/src/lib/env.test.ts`
- Modify: `admin/.env.example`
- Modify: `admin/src/server/errors/action-error.ts`
- Modify: `admin/src/server/errors/action-error.test.ts`
- Modify: `admin/src/features/versions/version-actions.ts`
- Modify: `admin/src/features/versions/version-actions.test.ts`
- Modify: `admin/src/features/versions/version-manager.tsx`
- Modify: `admin/src/features/publishing/publish-wizard.tsx`
- Modify: `admin/src/features/publishing/publish-wizard.test.tsx`

**Interfaces:**
- Produces `ServerEnv.externalApkPublishingEnabled: boolean` from `EXTERNAL_APK_PUBLISHING_ENABLED`, default `false`.
- Produces safe `FEATURE_DISABLED` action error message: `Harici APK yayınlama henüz etkin değil. Taslak korundu.`
- Changes `publishVersion(versionId, dependencies)` to accept no activation boolean and always call `publishRpc(actorId, versionId)` backed by `admin_publish_version_and_activate_app`.
- Consumes Task 1's `download_source` draft field and external-aware publication RPC.

- [ ] **Step 1: Write failing env/error tests**

Assert missing/`false` rollout env maps to false, `true` maps to true, invalid values fail closed, and `FEATURE_DISABLED` exposes only the approved Turkish message.

- [ ] **Step 2: Write failing publication tests**

Model drafts as a discriminated union:

```ts
type Draft =
  | Readonly<{ source: 'storage'; id: string; appId: string; draftPath: string; canonicalPath: string; size: number }>
  | Readonly<{ source: 'external'; id: string; appId: string }>;
```

Assert:

- Storage still copies/verifies canonical bytes and publishes while rollout is false.
- External skips all Storage inspection/copy calls.
- External with rollout false returns `FEATURE_DISABLED`, preserves the draft, and never calls RPC.
- External with rollout true calls the same activate RPC as Storage.
- Existing archived app publication passes no `isNew`/boolean switch and completes through activation.

- [ ] **Step 3: Run focused tests to verify RED**

Run:

```bash
cd admin && npm test -- src/lib/env.test.ts src/server/errors/action-error.test.ts src/features/versions/version-actions.test.ts src/features/publishing/publish-wizard.test.tsx
```

Expected: FAIL on missing env field/error code, source union, rollout gate, and old conditional activation calls.

- [ ] **Step 4: Implement rollout and publication behavior**

Read the flag only through `getServerEnv`; never expose it as `NEXT_PUBLIC_*`. Update `getDraft` to return the discriminated union. Storage performs the existing copy verification; external performs no fetch/copy. Both call only `admin_publish_version_and_activate_app` after their preconditions.

Remove the activation boolean from wizard and version-manager call sites.

- [ ] **Step 5: Run focused tests to verify GREEN**

Run the Step 3 command.

Expected: all tests pass; disabled external publication is explicit and non-destructive.

- [ ] **Step 6: Commit**

```bash
git add admin/.env.example admin/src/lib admin/src/server/errors admin/src/features/versions admin/src/features/publishing
git commit -m "feat: gate external APK publication"
```

### Task 5: Refresh and display admin visuals without browser reload

**Files:**
- Create: `admin/src/features/apps/asset-manager.test.tsx`
- Create: `admin/src/features/apps/screenshot-list.test.tsx`
- Modify: `admin/src/features/apps/asset-manager.tsx`
- Modify: `admin/src/features/apps/screenshot-list.tsx`
- Modify: `admin/app/(dashboard)/apps/[appId]/page.tsx`
- Modify: `admin/src/features/publishing/app-step.tsx`
- Modify: `admin/src/features/publishing/publish-wizard.tsx`
- Modify: `admin/src/features/publishing/publish-wizard.test.tsx`
- Modify: `admin/src/features/publishing/review-step.tsx`
- Modify: `admin/app/globals.css`

**Interfaces:**
- Changes `AssetManager` props to include `iconPath: string | null`.
- Changes `uploadIcon(appId, file): Promise<void>` to `Promise<string>` returning the saved public Storage path.
- Consumes Next App Router `useRouter` from `next/navigation`; successful mutations call `router.refresh()` after server `revalidatePath`.
- Preserves failed-upload retry without recreating the application.

- [ ] **Step 1: Write failing visual refresh tests**

Mock `next/navigation` and assert:

- Successful icon/screenshot metadata mutation calls `router.refresh()` exactly once and reports success.
- Upload or metadata failure does not refresh and shows the sanitized failure.
- Successful screenshot submission resets its file/alt fields.
- Update/delete screenshot success refreshes the list; failure does not.
- Icon retry returns a path, updates `SelectedPublishApp.iconPath`, and reaches review without a second app create.
- Review renders a descriptive icon preview when `iconPath` is present and no broken image when absent.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
cd admin && npm test -- src/features/apps/asset-manager.test.tsx src/features/apps/screenshot-list.test.tsx src/features/publishing/publish-wizard.test.tsx
```

Expected: FAIL because router refresh, icon path return/state, and previews are absent.

- [ ] **Step 3: Implement refresh and previews**

Use `router.refresh()` only after `saved.ok`. Pass `app.icon_path` into `AssetManager`; render current icon and screenshot thumbnails from the public `app-assets` URL with meaningful alt text. If plain `<img>` is used because runtime Supabase hosts cannot be statically allowlisted for `next/image`, scope the Next lint suppression to the preview lines only.

Return `intent.data.path` from `uploadAppIcon`, merge it into the created/retried app, and render it in review. Keep focus/status announcements intact.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run the Step 2 command.

Expected: all three files pass without duplicate refresh or record creation.

- [ ] **Step 5: Commit**

```bash
git add admin/app admin/src/features/apps admin/src/features/publishing
git commit -m "fix: refresh admin visuals after upload"
```

### Task 6: Carry explicit APK sources through the mobile catalog and downloader

**Files:**
- Modify: `src/features/catalog/catalog.types.ts`
- Modify: `src/features/catalog/catalog.mapper.ts`
- Modify: `src/features/catalog/catalog.repository.ts`
- Modify: `src/features/catalog/AppDetailScreen.tsx`
- Create: `src/features/downloads/apk-source.ts`
- Create: `tests/features/downloads/apk-source.test.ts`
- Modify: `src/features/downloads/apk-download.ts`
- Modify: `src/features/downloads/native-apk-download.ts`
- Modify: `src/features/downloads/verify-apk.ts`
- Modify: `src/features/downloads/useApkDownload.ts`
- Modify: mobile tests/fixtures containing `apkPath` under `tests/components` and `tests/features`

**Interfaces:**
- Produces `ApkSource = { kind: 'storage'; path: string } | { kind: 'external'; url: string }` in `catalog.types.ts`.
- Changes `CatalogVersion.apkPath` to `CatalogVersion.apkSource`.
- Changes `ApkDownloadInput.apkPath` to `ApkDownloadInput.apkSource`.
- Produces `resolveApkSourceUrl(source: ApkSource, publicStorageUrl: (path: string) => string): string`.
- Produces typed safe failures for source, network, size, APK magic, and SHA-256 integrity.
- Consumes Task 1's generated catalog row fields.

- [ ] **Step 1: Write failing catalog/source tests**

Update mapper fixtures to assert exact storage/external union values and rejection of mixed/missing fields. Add source resolver tests for valid Storage and public HTTPS input plus all URL input classes listed in Review Focus.

Update repository query expectations so detail versions select `download_source, apk_path, apk_url`.

- [ ] **Step 2: Write failing download/error tests**

Assert:

- Unsafe external source fails before `prepareDestination`/native task.
- Valid external URL is passed unchanged; Storage still uses `getPublicApkUrl`.
- Native task failure removes partial data and yields `APK bağlantısına ulaşılamadı.`
- Size mismatch yields `APK dosya boyutu doğrulanamadı.`
- Magic mismatch yields `İndirilen dosya geçerli bir APK değil.`
- Hash mismatch yields `APK bütünlük doğrulaması başarısız.`
- Every failure avoids installer/history/metric writes.
- Existing delayed-cancel tests run once for an external source and retain the `cancelling`/single-cancel/no-overlap behavior.

- [ ] **Step 3: Run focused tests to verify RED**

Run:

```bash
npm test -- --runInBand \
  tests/features/catalog/catalog.mapper.test.ts \
  tests/features/downloads/apk-source.test.ts \
  tests/features/downloads/apk-download.test.ts \
  tests/features/downloads/verify-apk.test.ts \
  tests/features/downloads/useApkDownload.test.tsx \
  tests/features/downloads/ApkDownloadPanel.test.tsx
```

Expected: FAIL because the discriminated source and typed user-facing failures do not exist.

- [ ] **Step 4: Implement catalog and resolver changes**

Map database fields into `ApkSource` only when exactly one source contract is valid. Update detail queries and all UI fixtures/call sites. Keep source validation independent of admin code because mobile is a separate package/runtime.

- [ ] **Step 5: Implement typed download failures**

Validate source before destination creation. Wrap native download failures separately from verification. Give `verifyApkChunks` a typed reason (`size`, `magic`, `sha256`) while preserving its chunked constant-memory behavior. Map only known safe typed errors into the UI; keep unknown internals behind the generic fallback.

- [ ] **Step 6: Run focused tests to verify GREEN**

Run the Step 3 command.

Expected: all listed suites pass with both source kinds and cancellation behavior covered.

- [ ] **Step 7: Run the full mobile suite**

Run:

```bash
npm test -- --runInBand
```

Expected: all mobile suites pass; no fixture still depends on `apkPath`.

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -m "feat: download verified external APK sources"
```

### Task 7: Add end-to-end publication and visual regressions

**Files:**
- Modify: `admin/e2e/run-local.sh`
- Modify: `admin/e2e/admin.spec.ts`
- Modify: `admin/e2e/helpers.ts`
- Modify: `admin/README.md`

**Interfaces:**
- Consumes Tasks 1–6.
- Sets `EXTERNAL_APK_PUBLISHING_ENABLED=true` only in the isolated local E2E environment.
- Produces operator documentation for the default-off production rollout and initial out-of-band `0.3.1` distribution.

- [ ] **Step 1: Add failing E2E cases**

Add tests that:

- Upload an icon and screenshot to an app detail page and observe the new preview/list item without `page.reload()`.
- Archive an existing app, create an external draft using `e2e/fixtures/test.apk` plus `https://downloads.example.com/releases/test.apk`, publish it, and poll for `{ app: 'active', version: 'published', source: 'external' }` without any `apks` Storage object.
- Keep the existing Storage E2E passing under the enabled external flag.
- Filter null `apk_path` values in cleanup so external versions never reach Storage removal calls.

- [ ] **Step 2: Run targeted E2E to verify RED**

Run:

```bash
cd admin && npm run test:e2e -- --grep "visual|external APK"
```

Expected: FAIL before implementation wiring/cleanup is complete.

- [ ] **Step 3: Complete E2E wiring and documentation**

Set the flag in `e2e/run-local.sh`, update cleanup, and document:

- 50,000,000-byte Storage guidance.
- Public direct-link/no-query requirements.
- Default-off rollout flag.
- EAS artifact bootstrap for `0.3.1`.
- Separate migration, deploy, build, distribution, and rollout approvals.

- [ ] **Step 4: Run full admin E2E to verify GREEN**

Run:

```bash
cd admin && npm run test:e2e
```

Expected: all Playwright tests pass and teardown leaves no E2E app, version, audit, or Storage objects.

- [ ] **Step 5: Commit**

```bash
git add admin/e2e admin/README.md
git commit -m "test: cover external APK publishing"
```

### Task 8: Run the complete local release gate

**Files:**
- Modify but do not commit without approval: `.memory/CURRENT.md`
- Review only: all files changed since `ec10b62`

**Interfaces:**
- Consumes completed Tasks 1–7.
- Produces a locally verified source commit ready for separate hosted migration/admin deploy/EAS approvals.

- [ ] **Step 1: Verify database from a clean reset**

Run:

```bash
npm run db:reset && npm run db:test && npx supabase db lint --local --level warning
```

Expected: every migration applies, all pgTAP tests pass, and lint is clean.

- [ ] **Step 2: Verify admin**

Run from `admin/`:

```bash
npm test && npm run typecheck && npm run lint && npm run build && npm run test:e2e
```

Expected: Vitest, TypeScript, ESLint, production build, and all Playwright tests pass.

- [ ] **Step 3: Verify mobile**

Run from repository root:

```bash
npm test -- --runInBand && npm run typecheck && npm run lint && npx expo-doctor
```

Expected: all Jest suites pass, typecheck/lint exit 0, and Expo Doctor reports all checks passed.

- [ ] **Step 4: Verify Android export**

Run:

```bash
npx expo export --platform android --output-dir /tmp/opencode/cep-depo-0.3.1-external-apk-export
```

Expected: export completes outside the repository with no route, environment, or bundling errors.

- [ ] **Step 5: Review diff and security artifacts**

Run:

```bash
git diff ec10b62...HEAD --check
git status --short
git log --oneline ec10b62..HEAD
git ls-files | grep -E '\.(apk|aab|jks|keystore)$' || true
```

Review every URL/log/audit path for secret leakage and confirm `.env.local` files are unchanged/untracked. Expected: no tracked binaries/signing files; only `.memory/CURRENT.md` remains intentionally modified.

- [ ] **Step 6: Update memory and stop at external-operation gates**

Record exact counts, source HEAD, migration filename, release identity, and pending approvals in `.memory/CURRENT.md` without committing it. Present results and request the first explicit approval: hosted migration.

### Task 9: Apply the hosted migration and deploy admin with rollout disabled

**Files:**
- Modify but do not commit without approval: `.memory/CURRENT.md`

**Interfaces:**
- Consumes Task 8 plus separate hosted migration and production admin deployment approvals.
- Produces hosted source-aware schema and production admin with `EXTERNAL_APK_PUBLISHING_ENABLED=false`.

- [ ] **Step 1: Verify target and dry run without mutation**

Confirm linked project ref is exactly `otksmbcuopinlecrfobe`; compare local/remote histories and run a database push dry run. Expected: only the reviewed external APK migration is pending and no destructive data loss appears.

- [ ] **Step 2: Stop for hosted migration approval, then apply once**

After explicit approval, push the migration, compare histories again, run hosted database lint/advisors, and verify existing versions remain `storage`.

- [ ] **Step 3: Configure rollout false without exposing values**

Ensure production has `EXTERNAL_APK_PUBLISHING_ENABLED=false`. Do not print secret values or alter unrelated variables.

- [ ] **Step 4: Stop for admin deployment approval, then deploy**

Deploy from the repository root using the existing Vercel project configuration. Record deployment ID/URL and the current READY deployment as rollback reference.

- [ ] **Step 5: Smoke test production safely**

Perform read-only route/auth/config checks first. Before creating any production test app, asset, Storage draft, or external draft, obtain explicit approval for those smoke-test mutations and define cleanup. Verify external publish rejection with the approved rollout message only on an approved disposable draft. Do not publish any production APK at this gate.

- [ ] **Step 6: Record evidence without committing memory**

Update `.memory/CURRENT.md` with migration/deployment evidence and request separate EAS build approval.

### Task 10: Build, physically verify, and enable external publication

**Files:**
- Create outside repository: `/tmp/opencode/cep-depo-0.3.1.apk`
- Modify but do not commit without approval: `.memory/CURRENT.md`

**Interfaces:**
- Consumes Task 9, explicit EAS build approval, physical-test confirmation, and separate rollout/deploy approval.
- Produces verified EAS artifact evidence and finally a production admin deployment with external publication enabled.

- [ ] **Step 1: Stop for EAS approval, then build**

After explicit approval run:

```bash
npx eas-cli build --platform android --profile release --non-interactive
```

Expected: package `com.cepdepo.app`, version `0.3.1`, versionCode `4`, successful internal APK artifact.

- [ ] **Step 2: Download and verify the APK outside the repository**

Download to `/tmp/opencode/cep-depo-0.3.1.apk`; verify ZIP integrity, byte size, SHA-256, application ID, version name/code, APK Signature Scheme v2, and signer certificate compatibility with `0.3.0` using `unzip`, `sha256sum`, `apkanalyzer`, and `apksigner`.

- [ ] **Step 3: Stop for physical installation/testing**

Ask the user to install over `0.3.0` from the EAS artifact and verify:

- Storage APK download/install.
- External direct HTTPS APK download/install.
- External bad-hash rejection.
- Cancel feedback, cleanup, and retry.
- In-place upgrade/signing compatibility.

Do not infer physical success from local tests.

- [ ] **Step 4: Stop for artifact distribution approval**

After physical success and explicit approval, share/use the EAS artifact through the agreed external channel. This is the bootstrap path for existing `0.3.0` users.

- [ ] **Step 5: Stop for rollout enablement and deployment approval**

After separate approval, set `EXTERNAL_APK_PUBLISHING_ENABLED=true`, redeploy admin, and record both new and rollback deployment IDs. Do not alter the database schema at this step.

- [ ] **Step 6: Production smoke test and final record**

Request a separate explicit approval for the exact external APK/version to publish. Then create or reuse that approved external draft, verify publication activates the app, and test its download on physical `0.3.1`. Record exact deployment/build/artifact/hash/signer/smoke evidence in `.memory/CURRENT.md`; do not commit memory or publish additional APKs without instruction.
