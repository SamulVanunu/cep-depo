# Cep Depo Admin Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragmented admin catalog workflow with one accessible three-step APK publishing flow that automatically uses a protected `Genel` category when no category is selected.

**Architecture:** Keep the existing Next.js App Router server/client boundary, Supabase service-role authorization, TUS upload path, and publication RPCs. Add one additive database migration for a durable default category and atomic publish-plus-activate transition, then compose the existing app, asset, upload, and version operations behind a focused `/publish` client wizard fed by server-rendered data. Existing moderation and user routes remain behaviorally unchanged while navigation, dashboard hierarchy, settings placement, and responsive CSS are simplified around publishing.

**Tech Stack:** Next.js 16.3.8 App Router, React 19.2.3, TypeScript 6, Supabase/PostgreSQL, Zod 4, tus-js-client 4, Vitest, Testing Library, Playwright, pgTAP, Vercel

**Spec:** `docs/superpowers/specs/2026-10-12-admin-redesign-design.md`

## Global Constraints

- Scope is admin redesign only; mobile notifications, OTA updates, new mobile APKs, and external APK share-link ingestion remain deferred.
- Vercel Root Directory remains `admin`; root Expo scripts and behavior must keep working.
- Do not add a UI framework, state library, upload proxy, or APK parser dependency.
- Every Server Action and privileged Route Handler must call `requireAdmin()` itself; rendering inside the protected layout is not authorization.
- `SUPABASE_SECRET_KEY` remains server-only and must not enter browser bundles, HTML, logs, audit metadata, or snapshots.
- APK limit stays exactly 500 MiB (`524288000` bytes); accepted MIME types remain APK and octet-stream; TUS chunks stay exactly 6 MiB.
- APK files continue to upload browser-to-Supabase; Vercel must not receive the APK body.
- Upload completion never publishes automatically; the manager must press the final `Yayınla` button.
- New applications created inside the wizard remain `archived` until atomic publication succeeds.
- Existing moderation, user self-protection, audit, CSP, RLS, and storage validation rules must not weaken.
- Expected validation and network failures return sanitized `ActionResult` values; untrusted backend details are not rendered.
- Production migration and Vercel deployment each require separate explicit user approval.
- `.memory/CURRENT.md` must remain uncommitted unless the user explicitly approves committing memory.

## Review Focus

- A database migration must end with exactly one active default `genel` category without changing existing app category assignments; pinned in Task 1.
- A forged or stale `appId` supplied through `/publish?appId=` or a direct Server Action must fail before upload signing or mutation; pinned in Tasks 2 and 3.
- Double-clicking create, finalize, or publish must not produce duplicate apps, versions, audit rows, or public transitions; pinned in Tasks 2, 4, and 5.
- Cancelling after a TUS intent exists must stop the client upload and expose the generated path to the existing safe orphan cleanup mechanism; pinned in Task 4.
- A canonical APK copied successfully before an RPC/network failure must be reusable on publish retry without re-uploading or corrupting status; pinned in Task 5.

---

### Task 1: Default Category and Atomic Publish Database Contract

**Files:**
- Create: `supabase/migrations/20261012123000_admin_default_category.sql`
- Create: `supabase/tests/admin_default_category.test.sql`
- Modify: `supabase/tests/admin_panel_transitions.test.sql`
- Regenerate: `src/types/database.types.ts`
- Regenerate: `admin/src/types/database.types.ts`

**Interfaces:**
- Consumes: existing `public.categories`, `public.apps`, `public.app_versions`, `private.require_admin_actor(uuid)`, and `public.admin_publish_version(uuid, uuid)`.
- Produces: `categories.is_default boolean`, one active default `Genel` category, and `public.admin_publish_version_and_activate_app(p_actor_id uuid, p_version_id uuid)` available only to `service_role`.

- [ ] **Step 1: Write the failing pgTAP tests for the default category**

Add assertions that a reset database has exactly one row where `is_default`, that it has slug `genel` and `is_active = true`, that a second default violates the partial unique index, and that `is_default = true, is_active = false` violates the check constraint. Snapshot the seeded apps' category IDs and assert the migration leaves those relationships unchanged.

- [ ] **Step 2: Write the failing pgTAP tests for atomic publication**

Extend `admin_panel_transitions.test.sql` with an archived test app and verified draft. Assert `admin_publish_version_and_activate_app` publishes the version, activates that app, writes one `version.publish` audit and one `app.activate` audit, is idempotent on retry, and leaves both records unchanged when canonical APK verification fails.

- [ ] **Step 3: Run the focused database tests and confirm failure**

Run: `npm run db:reset && npx supabase test db supabase/tests/admin_default_category.test.sql`

Expected: FAIL because `is_default` and `admin_publish_version_and_activate_app` do not exist.

- [ ] **Step 4: Implement the additive migration**

Add `is_default boolean not null default false`, `check (not is_default or is_active)`, and a partial unique index covering rows where `is_default`. Reuse and activate an existing `slug = 'genel'` row or insert `Genel`; mark exactly that row default without changing any `apps.category_id`. Create `admin_publish_version_and_activate_app(uuid, uuid)` as `SECURITY INVOKER`: verify the actor, invoke the existing verified publication transition in the same transaction, activate the owning app only after publication succeeds, and write `app.activate` only when status actually changes. Revoke `PUBLIC`/authenticated execution and grant only `service_role`.

- [ ] **Step 5: Run database reset, focused pgTAP, full pgTAP, and advisors**

Run: `npm run db:reset && npx supabase test db supabase/tests/admin_default_category.test.sql && npm run db:test && npx supabase db advisors --local`

Expected: focused and full pgTAP pass; advisors introduce no new schema/security errors.

- [ ] **Step 6: Regenerate both database type files**

Run: `npm run db:types && npx supabase gen types typescript --local > admin/src/types/database.types.ts`

Expected: both generated files contain `categories.Row.is_default` and `admin_publish_version_and_activate_app`; neither is hand-edited.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261012123000_admin_default_category.sql \
  supabase/tests/admin_default_category.test.sql \
  supabase/tests/admin_panel_transitions.test.sql \
  src/types/database.types.ts admin/src/types/database.types.ts
git commit -m "feat: add default catalog category"
```

### Task 2: Category Fallback and Quick Archived App Creation

**Files:**
- Modify: `admin/src/features/apps/app-schema.ts`
- Modify: `admin/src/features/apps/app-schema.test.ts`
- Modify: `admin/src/features/apps/app-actions.ts`
- Modify: `admin/src/features/apps/app-actions.test.ts`
- Modify: `admin/src/features/apps/app-dal.ts`

**Interfaces:**
- Consumes: `categories.is_default`, existing `createApp` authorization/audit pattern, existing slug normalization, and existing asset actions.
- Produces: `resolveAppCategoryId(requestedCategoryId: string | null, dependencies): Promise<string>`, `quickAppSchema`, `createQuickApp(raw, dependencies): Promise<ActionResult<{ id: string; slug: string; status: 'archived' }>>`, and `PublishAppOption` records for Task 3.

- [ ] **Step 1: Write failing schema tests**

Add tests proving the full app form accepts an empty `categoryId`, the quick form requires a 2–90 character title and 10–180 character short description, Turkish title normalization produces the existing slug format, and client-supplied status/category/featured fields are ignored by quick creation.

- [ ] **Step 2: Run schema tests and confirm failure**

Run: `npm --prefix admin test -- src/features/apps/app-schema.test.ts`

Expected: FAIL because category is still mandatory and `quickAppSchema` is missing.

- [ ] **Step 3: Implement schema parsing**

Change `appFormSchema.categoryId` to `z.string().uuid().nullable()` after normalizing an empty form value to `null`. Export `parseQuickAppInput(raw: unknown)` returning only `{ title, shortDescription, slug }`; derive slug with the existing `normalizeSlug` function rather than duplicating normalization.

- [ ] **Step 4: Write failing action tests for fallback and quick creation**

Add assertions that blank category resolves through `getDefaultCategoryId()`, an explicit existing category bypasses the default, a missing default returns sanitized `VALIDATION`, a forged explicit UUID is rejected before `insertApp`, and quick creation inserts exactly `{ category_id: defaultId, slug, title, short_description, description: shortDescription, featured: false, status: 'archived' }`. Submit the same quick input twice and assert the second unique slug conflict returns `CONFLICT` without a second successful audit.

- [ ] **Step 5: Run action tests and confirm failure**

Run: `npm --prefix admin test -- src/features/apps/app-actions.test.ts`

Expected: FAIL because the default lookup and quick action do not exist.

- [ ] **Step 6: Implement the action dependencies and quick action**

Extend `CatalogActionDependencies` with `getDefaultCategoryId(): Promise<string | null>`. Implement `resolveAppCategoryId`; use it in both `createApp` and `updateApp`. Add `createQuickApp` and `createQuickAppAction`, preserving authorize-before-secret-client construction, safe audit metadata, duplicate-submit conflict mapping, and revalidation of `/`, `/publish`, and `/apps`.

- [ ] **Step 7: Add publish option DAL**

Export `PublishAppOption = { id: string; title: string; slug: string; status: 'active' | 'archived'; iconPath: string | null; latestVersionCode: number | null }` and `listPublishApps(): Promise<readonly PublishAppOption[]>`. Query only fields needed by `/publish`, order by title, and derive the maximum existing version code without exposing private/audit data.

- [ ] **Step 8: Verify focused tests, typecheck, and lint**

Run: `npm --prefix admin test -- src/features/apps/app-schema.test.ts src/features/apps/app-actions.test.ts && npm --prefix admin run typecheck && npm --prefix admin run lint`

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add admin/src/features/apps
git commit -m "feat: simplify admin app creation"
```

### Task 3: Publish Route and Application Step

**Files:**
- Create: `admin/app/(dashboard)/publish/page.tsx`
- Create: `admin/src/features/publishing/publish-types.ts`
- Create: `admin/src/features/publishing/publish-selection.ts`
- Create: `admin/src/features/publishing/publish-selection.test.ts`
- Create: `admin/src/features/publishing/publish-wizard.tsx`
- Create: `admin/src/features/publishing/app-step.tsx`
- Create: `admin/src/features/publishing/publish-wizard.test.tsx`
- Modify: `admin/app/(dashboard)/apps/[appId]/versions/new/page.tsx`

**Interfaces:**
- Consumes: `listPublishApps()`, `createQuickAppAction`, existing `requestAssetUploadAction`/`setAppIconAction`, and a server-resolved optional query `appId`.
- Produces: `resolvePreselectedApp(rawAppId: string | undefined, apps: readonly PublishAppOption[]): { app: PublishAppOption | null; invalid: boolean }`, `PublishWizardState`, a three-step `PublishWizard`, and a compatibility redirect from the old version route.

- [ ] **Step 1: Write failing route/selection tests**

In `publish-selection.test.ts`, test that no query returns `{ app: null, invalid: false }`, a valid listed UUID returns that app, and malformed/nonexistent values return `{ app: null, invalid: true }`. In the page test, assert invalid selection renders a Turkish recoverable warning. Assert the old version route redirects to `/publish?appId=<encoded uuid>`.

- [ ] **Step 2: Write failing application-step component tests**

Assert searchable existing-app selection, latest version code context, switching to new-app mode, required title/short-description validation, duplicate submit prevention, safe server error display, and successful transition to APK step with the returned archived app ID. Assert optional icon upload failure leaves the new app selected and offers icon retry instead of discarding the app.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npm --prefix admin test -- src/features/publishing/publish-selection.test.ts src/features/publishing/publish-wizard.test.tsx`

Expected: FAIL because publishing components and route do not exist.

- [ ] **Step 4: Define the wizard state boundary**

In `publish-types.ts`, define discriminated steps `app | apk | review | complete`, selected app metadata, optional new-app marker, and draft review metadata. Keep `File`, Supabase clients, server secrets, and raw backend errors out of serializable state types.

- [ ] **Step 5: Implement the server page and application step**

Keep `/publish/page.tsx` a Server Component that calls `listPublishApps()` and validates the awaited `searchParams`. Keep only interaction/file APIs inside client components. Use semantic fieldsets, field-level messages, `aria-live`, and focus the APK-step heading after success. Upload an optional icon through the existing signed asset action after quick app creation; never send the image through a Server Action.

- [ ] **Step 6: Implement compatibility redirect**

Replace the old version page body with a server `redirect('/publish?appId=...')`; do not keep two upload UIs.

- [ ] **Step 7: Verify focused tests, typecheck, lint, and build**

Run: `npm --prefix admin test -- src/features/publishing/publish-selection.test.ts src/features/publishing/publish-wizard.test.tsx && npm --prefix admin run typecheck && npm --prefix admin run lint && npm --prefix admin run build`

Expected: all commands exit 0 and Next emits `/publish` successfully.

- [ ] **Step 8: Commit**

```bash
git add admin/app/'(dashboard)'/publish \
  admin/app/'(dashboard)'/apps/'[appId]'/versions/new/page.tsx \
  admin/src/features/publishing
git commit -m "feat: add guided admin publishing flow"
```

### Task 4: Cancelable APK Upload and Review Summary

**Files:**
- Modify: `admin/src/features/uploads/tus-upload.ts`
- Modify: `admin/src/features/uploads/hash-file.ts`
- Create: `admin/src/features/uploads/hash-file.test.ts`
- Modify: `admin/src/features/uploads/upload.test.ts`
- Refactor: `admin/src/features/uploads/upload-wizard.tsx`
- Create: `admin/src/features/publishing/apk-step.tsx`
- Create: `admin/src/features/publishing/review-step.tsx`
- Create: `admin/src/features/publishing/apk-step.test.tsx`
- Modify: `admin/src/features/uploads/orphan-cleanup.ts`
- Modify: `admin/src/features/uploads/orphan-panel.tsx`

**Interfaces:**
- Consumes: `hashFile`, `createUploadIntentAction`, `finalizeUploadAction`, `cleanupOrphanUploadAction`, and wizard selection from Task 3.
- Produces: `hashFile(file: File, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<string>`, `TusUploadHandle = { abort(shouldTerminate?: boolean): Promise<void> }`, upload phases `idle | hashing | uploading | finalizing | error | complete`, and `PublishReview` containing app/version/file/size/SHA-256/changelog.

- [ ] **Step 1: Write the failing TUS cancellation test**

Extend the fake constructor to expose `abort`. Assert `startTusUpload(...)` returns a handle, `handle.abort(true)` calls the same upload instance once, and existing 6 MiB chunk/resume behavior remains unchanged.

- [ ] **Step 2: Run the upload unit test and confirm failure**

Run: `npm --prefix admin test -- src/features/uploads/upload.test.ts`

Expected: FAIL because the returned upload instance has no typed abort handle.

- [ ] **Step 3: Implement the minimal cancelable adapter**

Extend `TusInstance` with `abort`, return only a frozen `{ abort }` handle from `startTusUpload`, and preserve headers, retry delays, metadata, resumability, and fingerprint cleanup exactly.

- [ ] **Step 4: Write and run the failing hash cancellation test**

In `hash-file.test.ts`, abort an `AbortController` from the first progress callback and assert `hashFile` rejects with an `AbortError` before reporting completion. Run: `npm --prefix admin test -- src/features/uploads/hash-file.test.ts`. Expected: FAIL because `hashFile` does not consume a signal.

- [ ] **Step 5: Implement cooperative hash cancellation**

Accept an optional `AbortSignal`, call `signal.throwIfAborted()` before each 4 MiB read and immediately after each awaited read, and leave the incremental SHA-256/chunk size unchanged.

- [ ] **Step 6: Write failing APK-step tests**

Test invalid extension/MIME/zero-byte/over-500-MiB rejection before signing; progress text with percent and MB; duplicate submit suppression; cancellation during hashing without requesting a token; cancellation during upload calling `abort(true)` and then `cleanupOrphanUploadAction(intent.path)`; retry after hash/upload/finalize failure; and successful finalize producing a review summary with the full 64-character lowercase SHA-256 value.

- [ ] **Step 7: Run component tests and confirm failure**

Run: `npm --prefix admin test -- src/features/publishing/apk-step.test.tsx`

Expected: FAIL because `ApkStep` does not exist.

- [ ] **Step 8: Implement `ApkStep` and shrink the legacy component**

Move orchestration out of `upload-wizard.tsx` into `ApkStep`; retain a thin compatibility export only if another caller still imports `UploadWizard`, otherwise delete it after grep confirms no caller. Model expected errors as rendered state, keep technical exceptions sanitized, use an accessible progressbar/live message, and focus the error or review heading after transitions.

- [ ] **Step 9: Implement `ReviewStep` presentation**

Render app title/icon, version name/code, file name, exact bytes plus MB, changelog, automatic `Genel` note for new apps, and a copyable full SHA-256 detail. `ReviewStep` must not publish in this task; it emits `onPublish` once and disables controls while pending for Task 5.

- [ ] **Step 10: Verify upload/publishing tests and static gates**

Run: `npm --prefix admin test -- src/features/uploads/hash-file.test.ts src/features/uploads/upload.test.ts src/features/publishing/apk-step.test.tsx src/features/publishing/publish-wizard.test.tsx && npm --prefix admin run typecheck && npm --prefix admin run lint`

Expected: all commands exit 0.

- [ ] **Step 11: Commit**

```bash
git add admin/src/features/uploads admin/src/features/publishing
git commit -m "feat: add cancelable APK publishing steps"
```

### Task 5: Explicit Publication, Retry, and Completion

**Files:**
- Modify: `admin/src/features/versions/version-actions.ts`
- Modify: `admin/src/features/versions/version-actions.test.ts`
- Modify: `admin/src/features/publishing/publish-wizard.tsx`
- Modify: `admin/src/features/publishing/review-step.tsx`
- Modify: `admin/src/features/publishing/publish-wizard.test.tsx`

**Interfaces:**
- Consumes: `admin_publish_version` for existing active apps and `admin_publish_version_and_activate_app` for wizard-created archived apps.
- Produces: `publishVersionAction(versionId: string, activateApp?: boolean): Promise<ActionResult<{ status: 'published' }>>` and a complete-state result linking to `/apps/[appId]` and `/apps`.

- [ ] **Step 1: Write failing version action tests**

Assert `activateApp = false` calls the existing RPC, `activateApp = true` calls the atomic publish-and-activate RPC, invalid IDs fail before storage access, and a first RPC failure followed by retry reuses an existing same-size canonical object without another copy. Assert a mismatched canonical size remains a `CONFLICT` and never calls either RPC.

- [ ] **Step 2: Run version tests and confirm failure**

Run: `npm --prefix admin test -- src/features/versions/version-actions.test.ts`

Expected: FAIL because activation-aware publication is missing.

- [ ] **Step 3: Implement activation-aware publication**

Extend `PublishDependencies.publishRpc(actorId, versionId, activateApp)` and choose the correct RPC in default dependencies. Preserve authorize-first ordering, canonical copy verification, safe errors, and idempotent retry. Revalidate `/`, `/publish`, `/apps`, and `/apps/[appId]` only after success.

- [ ] **Step 4: Write failing final-step tests**

Assert the final button is labeled `Yayınla`, review alone causes no publish call, double click invokes one action, failure keeps review data and enables `Tekrar yayınla`, success renders a completion state, and wizard-created apps pass `activateApp = true` while existing app releases pass `false`.

- [ ] **Step 5: Implement final publication and recovery**

Wire `ReviewStep` to `publishVersionAction`. Do not reset selected app, draft ID, hash, or size after a failed publication. On success, replace the form with concise confirmation and links; do not automatically navigate before assistive technology can announce success.

- [ ] **Step 6: Verify focused and related tests**

Run: `npm --prefix admin test -- src/features/versions/version-actions.test.ts src/features/publishing/publish-wizard.test.tsx src/features/publishing/apk-step.test.tsx`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add admin/src/features/versions admin/src/features/publishing
git commit -m "feat: publish verified APKs from wizard"
```

### Task 6: Navigation, Dashboard, Apps, Settings, and Responsive UI

**Files:**
- Modify: `admin/src/components/navigation/sidebar.tsx`
- Modify: `admin/src/features/dashboard/dashboard-view.tsx`
- Modify: `admin/src/features/dashboard/dashboard-dal.ts`
- Modify: `admin/src/features/dashboard/dashboard.test.tsx`
- Modify: `admin/app/(dashboard)/apps/page.tsx`
- Modify: `admin/src/features/apps/app-list.tsx`
- Create: `admin/src/features/apps/app-list.test.tsx`
- Modify: `admin/src/features/apps/app-dal.ts`
- Modify: `admin/app/(dashboard)/apps/[appId]/page.tsx`
- Modify: `admin/src/features/apps/app-form.tsx`
- Modify: `admin/src/features/apps/app-actions.test.ts`
- Modify: `admin/src/features/apps/category-manager.tsx`
- Create: `admin/app/(dashboard)/settings/page.tsx`
- Create: `admin/src/features/apps/category-manager.test.tsx`
- Modify: `admin/app/globals.css`

**Interfaces:**
- Consumes: `/publish`, `CategoryOption.isDefault`, existing dashboard summary, list filters, app detail managers, and category actions.
- Produces: publishing-first navigation, dashboard primary CTA, simplified app rows, protected settings category management, and usable upload UI below 48rem.

- [ ] **Step 1: Write failing navigation/dashboard tests**

Assert links appear in this order: `APK Yükle`, `Uygulamalar`, `Yorumlar`, `Şikâyetler`, `Kullanıcılar`, `Ayarlar`; `/publish` is active only on the publish route; dashboard has a visually primary `APK Yükle` link before queue metrics and renders the five latest published apps; and logout remains present.

- [ ] **Step 2: Write failing settings/category tests**

Assert `/apps` no longer renders `CategoryManager`, `/settings` does, `Genel` has a `Varsayılan` label, and its active control is disabled while non-default categories remain editable. In `app-actions.test.ts`, directly submit an inactive default category and assert `VALIDATION` before `updateCategory`; do not rely only on the disabled checkbox.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npm --prefix admin test -- src/features/dashboard/dashboard.test.tsx src/features/apps/category-manager.test.tsx`

Expected: FAIL against the old navigation/dashboard/category placement.

- [ ] **Step 4: Implement information architecture changes**

Add the `/settings` Server Component, load both categories and `listOrphanUploads()`, and move `CategoryManager` plus `OrphanPanel` there. Keep review/report URLs separate but visually adjacent in navigation; do not invent a new data route. Change app detail primary action to `/publish?appId=<id>`. Extend `listApps` with the latest version name/code needed by the table and simplify list cells to app, latest version, status, and `Yönet`, while preserving search/status/category filters and pagination. Extend `DashboardSummary` with the five latest published apps and render them below the primary publish action.

- [ ] **Step 5: Implement category protection**

Extend `CategoryOption` with `isDefault`; render its marker and prevent deactivation in both `CategoryManager` and server action validation. Keep category create/update audit behavior unchanged.

- [ ] **Step 6: Implement responsive and wizard styling**

Update `globals.css` using existing semantic tokens. At max-width 48rem, convert navigation to a compact wrapped/header layout, stack wizard controls, keep APK fields visible, preserve 44px minimum targets and focus outlines, and remove the old `.publish-fields { display: none }`/desktop-only warning behavior. Do not add gradients, decorative shadows, animation dependencies, or horizontal page overflow.

- [ ] **Step 7: Verify component tests and admin gates**

Run: `npm --prefix admin test -- src/features/dashboard/dashboard.test.tsx src/features/apps/category-manager.test.tsx src/features/apps/app-list.test.tsx src/features/apps/app-actions.test.ts && npm --prefix admin run typecheck && npm --prefix admin run lint && npm --prefix admin run build`

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add admin/app admin/src/components/navigation admin/src/features/dashboard \
  admin/src/features/apps admin/app/globals.css
git commit -m "feat: simplify admin navigation and layout"
```

### Task 7: End-to-End Publishing and Accessibility Regression

**Files:**
- Modify: `admin/e2e/admin.spec.ts`
- Modify: `admin/e2e/accessibility.spec.ts`
- Modify: `admin/e2e/helpers.ts`
- Modify: `admin/e2e/access-control.spec.ts`
- Modify: `admin/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: completed `/publish` flow, local Supabase fixtures, existing Playwright auth state, `test.apk`, and cleanup helpers.
- Produces: physical-browser proof for new/existing publication, navigation/accessibility coverage, and updated operator instructions.

- [ ] **Step 1: Replace the fragmented create/upload E2E with the approved new-app flow**

Create a unique app through `/publish`, leave category untouched, optionally attach the small icon fixture if present, upload `e2e/fixtures/test.apk`, verify progress/review text, press `Yayınla`, and poll for `{ app.status: 'active', version.status: 'published', category.slug: 'genel' }`. Assert exactly one app/version and matching audit actions, then clean Storage/database fixtures.

- [ ] **Step 2: Add existing-app publication and retry E2E**

Precreate an app, open `/publish?appId=<id>`, publish the test APK with a unique version code, and assert no duplicate app is created. Exercise a recoverable validation failure before success without reselecting the app. Keep canonical object cleanup in `finally`.

- [ ] **Step 3: Update navigation/access-control E2E**

Assert the new navigation destinations, `/settings` admin protection, direct unauthenticated `/publish` redirect, and non-admin denial. Preserve logout, moderation, report, user lifecycle, and admin self-protection tests.

- [ ] **Step 4: Add wizard accessibility and narrow-viewport E2E**

Assert the step list exposes `aria-current="step"`, labels are programmatic, validation errors are announced and focus the invalid field, progress has role/value text, final success is announced, keyboard-only navigation works, and at a narrow viewport the APK input/button remain visible without horizontal page overflow. Continue failing on browser console/page errors.

- [ ] **Step 5: Run full local E2E**

Run: `npm --prefix admin run test:e2e`

Expected: all Playwright tests pass with zero collected console/page errors and cleanup leaves no E2E app/version/storage objects.

- [ ] **Step 6: Update operator documentation**

Document the three-step publish path, automatic `Genel`, explicit final publish, cancellation/retry, orphan cleanup location under Settings, and the rule that hosted migration/deployment still require explicit approval. Do not document secrets or local admin passwords.

- [ ] **Step 7: Commit**

```bash
git add admin/e2e admin/README.md README.md
git commit -m "test: cover simplified admin publishing"
```

### Task 8: Full Verification and Release Readiness

**Files:**
- Modify but do not commit without approval: `.memory/CURRENT.md`
- Review only: all files changed since `8e449c0`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: a verified, commit-clean source branch ready for separately approved hosted migration and preview/production deployment.

- [ ] **Step 1: Run fresh database verification**

Run: `npm run db:reset && npm run db:test && npx supabase db lint --local && npx supabase db advisors --local`

Expected: reset and all pgTAP files pass; lint/advisors show no new schema/security issue.

- [ ] **Step 2: Run fresh admin verification**

Run: `npm --prefix admin test && npm --prefix admin run typecheck && npm --prefix admin run lint && npm --prefix admin run build && npm --prefix admin run test:e2e`

Expected: Vitest, typecheck, lint, production build, and all Playwright tests exit 0.

- [ ] **Step 3: Confirm the mobile project remains unaffected**

Run: `npm test -- --runInBand && npm run typecheck && npm run lint && npx expo-doctor`

Expected: mobile Jest, TypeScript, lint, and Expo Doctor pass without source behavior changes.

- [ ] **Step 4: Review security and release diff**

Run: `git diff 8e449c0...HEAD --check && git status --short && git log --oneline 8e449c0..HEAD`

Expected: no whitespace errors; only `.memory/CURRENT.md` may remain intentionally modified; commits match Tasks 1–7. Manually verify no secret value, `.env*`, APK, credential, service key, or generated test artifact is tracked.

- [ ] **Step 5: Update durable memory without committing it**

Record completed commits, exact verification counts, remaining physical preview upload test, hosted migration approval gate, and deployment approval gate in `.memory/CURRENT.md`. Do not include credentials or commit the memory file.

- [ ] **Step 6: Stop at external approval gates**

Do not run `supabase db push`, create a Vercel preview connected to production writes, or deploy production. Present the verified local result and request explicit approval first for the hosted migration, then separately for deployment.
