# Automatic APK Publishing and Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace user-entered APK version data and visible drafts with manifest-driven automatic publication, then complete the Manage page with safe update, unpublish/republish, and permanent-delete operations.

**Architecture:** Keep the existing authenticated admin, TUS/external source union, and mobile integrity contract. Add a browser-only APK manifest adapter, additive package-identity/cleanup schema, transaction-backed publish-replace/delete RPCs, and server orchestration that compensates Storage failures without exposing drafts to operators.

**Tech Stack:** Next.js 16.3.8, React 19.2.3, TypeScript 6.0.3, Supabase/PostgreSQL/pgTAP, Vitest 5, Playwright 1.63, `apk-meta-parser` 0.2.3 with `jszip` 3.10.2 and `spark-md5` 3.0.2.

**Spec:** `docs/superpowers/specs/2026-10-15-automatic-apk-publishing-management-design.md`

## Global Constraints

- Keep APK sources as the existing explicit `storage | external` discriminated union.
- Keep the Supabase Storage routing threshold exactly `50_000_000` bytes.
- Keep external URLs public HTTPS without credentials, query, fragment, localhost, private, link-local, or special-use hosts.
- Keep `EXTERNAL_APK_PUBLISHING_ENABLED` server-only, default `false`, and checked before an external version can publish.
- Keep mobile byte-size, ZIP-magic, and SHA-256 verification unchanged.
- Never put GitHub credentials in the admin application; external GitHub assets are not deleted by admin operations.
- Require authenticated admin authorization in every server action and RPC; UI guards are not authorization.
- Icon is required for first publication; screenshots are optional, but each supplied screenshot requires 2–180 characters of alt text.
- Read `admin/AGENTS.md` and relevant local Next.js 16 documentation under `admin/node_modules/next/dist/docs/` before changing Next/React code.
- Use TDD: observe the focused test fail before implementation, then run focused and aggregate verification.
- Do not alter `.memory/CURRENT.md` except at a milestone, and never commit it without explicit approval.
- Do not commit, push, apply hosted migrations, mutate production data/env, deploy, or publish a real APK without the user's separate explicit approval. Where this plan says “commit”, stop at that protected gate unless approval has been given.

## Review Focus

- Truncated, split, resource-referenced, or malformed APK manifests must fail before upload/publication; no heuristic/partial metadata may publish.
- Two concurrent updates with the same or competing version codes must serialize so only one replaces the active version and the winner cannot be deleted by the loser.
- Storage deletion failure after a successful publish/delete must leave the public catalog correct and create one idempotent cleanup job without leaking raw errors or URLs.
- Existing apps with `package_name = null` may establish identity once; after that, mismatched package names and equal/lower version codes must fail without touching the current release.
- Permanent delete must handle comments, follows, reports, screenshots, downloads, versions, and Storage paths without deleting external GitHub assets or unrelated objects.

---

### Task 1: Browser APK Manifest Adapter

**Files:**
- Modify: `admin/package.json`
- Modify: `admin/package-lock.json`
- Create: `admin/src/features/uploads/apk-manifest.ts`
- Create: `admin/src/features/uploads/apk-manifest.test.ts`
- Create: `admin/src/features/uploads/fixtures/manifest-apk.ts`

**Interfaces:**
- Produces: `ParsedApkManifest` with `packageName`, `versionName`, `versionCode`, optional `minSdkVersion`, optional `targetSdkVersion`.
- Produces: `parseApkManifest(file: Blob): Promise<ParsedApkManifest>`.
- Consumes later: `ApkStep` and automatic publication payloads.

- [ ] **Step 1: Add failing parser contract tests**

Cover a generated structurally valid APK fixture containing binary `AndroidManifest.xml`, malformed ZIP, missing manifest, partial/heuristic result, empty package/version name, `versionCode <= 0`, non-integer/unsafe/out-of-PostgreSQL-range code, and a large sparse Blob proving parser options use `skipMd5: true`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/features/uploads/apk-manifest.test.ts` from `admin/`.
Expected: FAIL because `parseApkManifest` does not exist.

- [ ] **Step 3: Assess and install exact parser dependencies**

Confirm licenses and browser support, then install exact versions `apk-meta-parser@0.2.3`, `jszip@3.10.2`, and `spark-md5@3.0.2`. Record bundle/build concerns in the task report; do not substitute another package without updating the spec/plan ruling.

- [ ] **Step 4: Implement the adapter**

Export the exact interfaces above. Call the parser with MD5 disabled, reject partial/heuristic output, normalize no values except surrounding whitespace, enforce Android package syntax and the existing version-name/PostgreSQL integer limits, and translate parser failures to one operator-safe Turkish error.

- [ ] **Step 5: Verify GREEN and build compatibility**

Run focused Vitest, `npm run typecheck`, and `npm run build`. Expected: all pass; parser code remains in the client chunk only where used.

- [ ] **Step 6: Protected commit gate**

Proposed commit: `feat(admin): parse APK manifest metadata`. Do not commit without explicit approval.

---

### Task 2: Package Identity and Cleanup Schema

**Files:**
- Create: `supabase/migrations/20261015130000_automatic_apk_publication_foundation.sql`
- Create: `supabase/tests/automatic_apk_publication_foundation.test.sql`
- Modify: `admin/src/types/database.types.ts`
- Modify: `admin/src/features/uploads/upload-schema.ts`
- Modify: `admin/src/features/uploads/upload-schema.test.ts`

**Interfaces:**
- Produces: nullable `apps.package_name` for legacy compatibility.
- Produces: nullable `app_versions.package_name` for legacy migration compatibility; all new version actions/RPCs require it.
- Produces: private/service-managed `admin_asset_cleanup_jobs` with canonical bucket/path, operation id, attempts, timestamps, and unique pending object identity.
- Produces: audit actions `app.delete`, `version.replace`, and `asset.cleanup_pending` without permitting secret/full external URL metadata.

- [ ] **Step 1: Write failing pgTAP and Zod tests**

Assert package-name format, legacy nullable app identity, mandatory version identity, invalid bucket/path rejection, one pending cleanup row per object, RLS denial to anon/authenticated clients, and no raw URL/error metadata in audit/cleanup fields.

- [ ] **Step 2: Run tests and verify RED**

Run the focused pgTAP file after local reset and the focused upload-schema Vitest file. Expected: missing columns/table/schema fields.

- [ ] **Step 3: Implement the additive migration**

Use an Android package-name constraint that requires at least two dot-separated Java-style identifiers, preserve legacy rows, constrain cleanup bucket names to Cep Depo-managed buckets, and enable RLS with no public policies. Extend the audit action constraint and safe metadata allowlist only with fields required by this spec.

- [ ] **Step 4: Regenerate/update database types and upload schemas**

Add `packageName`, parsed `versionName`, and parsed integer `versionCode` to storage/external draft inputs. No action may accept manually typed values from a form; values come from Task 1's adapter.

- [ ] **Step 5: Verify GREEN**

Run clean local reset, focused pgTAP, all pgTAP, database lint, focused Vitest, and TypeScript.

- [ ] **Step 6: Protected commit gate**

Proposed commit: `feat(db): add APK identity and cleanup jobs`. Do not commit or apply hosted migration without explicit approval.

---

### Task 3: Atomic Publish-and-Replace RPC

**Files:**
- Create: `supabase/migrations/20261015131000_publish_replace_apk_version.sql`
- Create: `supabase/tests/publish_replace_apk_version.test.sql`
- Modify: `admin/src/features/versions/version-actions.ts`
- Modify: `admin/src/features/versions/version-actions.test.ts`
- Create: `admin/src/features/uploads/asset-cleanup.ts`
- Create: `admin/src/features/uploads/asset-cleanup.test.ts`

**Interfaces:**
- Produces SQL: `admin_publish_version_replacing_previous(p_actor_id uuid, p_version_id uuid) returns text[]` where returned values are old Supabase APK paths only.
- Produces TS: `publishVersionReplacingPrevious(versionId: string, dependencies: ReplaceVersionDependencies): Promise<ActionResult<{ status: 'published'; cleanupPending: boolean }>>`.
- Produces TS: `removeOrEnqueueAssets(assets: readonly CleanupAsset[], dependencies: CleanupDependencies): Promise<{ pending: number }>`.
- Produces action: `publishVersionReplacingPreviousAction(versionId: string)`.

- [ ] **Step 1: Write failing transaction tests**

Cover admin-only access, new app first publish, archived app activation, first legacy package identity establishment, package mismatch, equal/lower version code, external flag disabled, new Storage object validation, successful replacement deleting old DB versions, returning only old Storage paths, retaining external URLs remotely, and two concurrent versions where exactly one wins.

- [ ] **Step 2: Run focused SQL tests and verify RED**

Expected: missing RPC and replacement behavior.

- [ ] **Step 3: Implement the RPC**

Lock the target app and relevant versions, validate the candidate is draft, enforce source-specific invariants and package/version rules, publish candidate, activate app, delete all other version rows, and insert audit entries in one transaction. Never make Storage HTTP calls inside SQL.

- [ ] **Step 4: Write failing server orchestration tests**

Assert canonical Storage copy/inspection occurs before RPC, external flag blocks before RPC, RPC failure preserves the previous published version, old Storage cleanup runs only after RPC success, cleanup failure enqueues exactly one idempotent job, and raw errors/URLs are not returned.

- [ ] **Step 5: Implement cleanup and server action**

Reuse existing source-aware draft lookup/canonical copy patterns. Replace `publishVersionAction` consumers only after the new action passes; retain compatibility until Task 6 removes the manual review route.

- [ ] **Step 6: Verify GREEN**

Run focused SQL/Vitest, all pgTAP, all admin Vitest, TypeScript, and database lint.

- [ ] **Step 7: Protected commit gate**

Proposed commit: `feat(admin): publish and replace APK versions atomically`. Do not commit without explicit approval.

---

### Task 4: Publication Status and Permanent Delete

**Files:**
- Create: `supabase/migrations/20261015132000_app_lifecycle_management.sql`
- Create: `supabase/tests/app_lifecycle_management.test.sql`
- Modify: `admin/src/features/apps/app-actions.ts`
- Modify: `admin/src/features/apps/app-actions.test.ts`
- Create: `admin/src/features/apps/app-delete-panel.tsx`
- Create: `admin/src/features/apps/app-delete-panel.test.tsx`
- Modify: `admin/src/features/apps/app-status-panel.tsx`
- Modify: `admin/src/features/apps/app-status-panel.test.tsx` if absent, otherwise create it.

**Interfaces:**
- Produces SQL: `admin_set_app_publication_status(p_actor_id uuid, p_app_id uuid, p_status app_status) returns void` restricted to `active | archived` and requiring a published version/icon before activation.
- Produces SQL: `admin_delete_app_permanently(p_actor_id uuid, p_app_id uuid, p_confirmation_title text) returns jsonb` containing only Cep Depo-managed Storage bucket/path pairs.
- Produces actions: `setAppPublicationStatusAction(appId, status)` and `deleteAppPermanentlyAction(appId, confirmationTitle)`.

- [ ] **Step 1: Write failing lifecycle pgTAP tests**

Cover archive/activate idempotency, activation prerequisites, typed title mismatch, comments/follows/reports/downloads/screenshots/version cascades, audit persistence, returned icon/screenshot/storage APK paths, omitted external URLs, unrelated-object preservation, and concurrent delete/update serialization.

- [ ] **Step 2: Verify SQL RED, then implement RPCs**

Adjust only the FK/cascade rules proven necessary by tests. Collect managed paths before DB deletion; perform no Storage deletion in SQL.

- [ ] **Step 3: Write failing action/component tests**

Assert admin authorization, safe action errors, post-transaction `removeOrEnqueueAssets`, typed-name button gating, duplicate-submit prevention, labels `Yayından kaldır`/`Tekrar yayınla`/`Kalıcı sil`, and keyboard/focus behavior.

- [ ] **Step 4: Implement actions and panels**

Keep permanent delete in a separate danger panel. Redirect to `/apps` only after DB deletion succeeds; show cleanup-pending warning without claiming deletion failed.

- [ ] **Step 5: Verify GREEN**

Run focused SQL/Vitest, all pgTAP, admin Vitest, TypeScript, ESLint, and accessibility-focused tests.

- [ ] **Step 6: Protected commit gate**

Proposed commit: `feat(admin): manage app publication and deletion`. Do not commit without explicit approval.

---

### Task 5: Complete Application Details and Initial Assets

**Files:**
- Modify: `admin/src/features/publishing/app-step.tsx`
- Modify: `admin/src/features/publishing/app-step.test.tsx`
- Modify: `admin/src/features/apps/app-schema.ts`
- Modify: `admin/src/features/apps/app-schema.test.ts`
- Modify: `admin/src/features/apps/app-actions.ts`
- Modify: `admin/src/features/apps/app-actions.test.ts`
- Modify: `admin/src/features/apps/asset-actions.ts`
- Modify: `admin/src/features/apps/asset-manager.tsx`
- Modify: `admin/src/features/publishing/publish-types.ts`

**Interfaces:**
- Replaces quick input with `PublishingAppInput`: `title`, `slug`, `categoryId`, `shortDescription`, `description`, `featured`.
- Produces `createPublishingAppAction(input)` returning an archived staging app owned by the current operation.
- Produces initial asset state containing required `iconPath` and optional screenshot `{ path, altText, position }[]`.
- Consumes Task 4 permanent-delete action for compensation when a newly staged app cannot publish.

- [ ] **Step 1: Write failing schema/UI tests**

Assert active category selection is mandatory, slug normalization remains editable, title/short/detail limits, icon required, screenshots optional, supplied screenshot alt text required, inactive category rejected server-side, and no staging app is created while fields are invalid.

- [ ] **Step 2: Run focused tests and verify RED**

- [ ] **Step 3: Implement complete AppStep**

Reuse existing signed asset intents and refresh behavior. Create the archived staging app only after text/category validation; upload the required icon and optional screenshots with operation-scoped cleanup. Do not expose a draft selector/list.

- [ ] **Step 4: Add compensation tests and implementation**

If icon/screenshot upload or metadata insertion fails, delete newly created app data and remove/enqueue uploaded assets. Existing-app mode must never delete the existing app on asset failure.

- [ ] **Step 5: Verify GREEN**

Run focused Vitest, complete admin Vitest, TypeScript, ESLint, and production build.

- [ ] **Step 6: Protected commit gate**

Proposed commit: `feat(admin): collect complete publishing details`. Do not commit without explicit approval.

---

### Task 6: Manifest-Driven Automatic Publication Wizard

**Files:**
- Modify: `admin/src/features/publishing/apk-step.tsx`
- Modify: `admin/src/features/publishing/apk-step.test.tsx`
- Modify: `admin/src/features/publishing/publish-wizard.tsx`
- Modify: `admin/src/features/publishing/publish-wizard.test.tsx`
- Modify: `admin/src/features/publishing/publish-types.ts`
- Delete: `admin/src/features/publishing/review-step.tsx` after all consumers/tests move.
- Modify: `admin/src/features/uploads/upload-actions.ts`
- Modify: `admin/src/features/uploads/upload.test.ts`
- Modify: `admin/src/features/uploads/external-draft-actions.ts`
- Modify: `admin/src/features/uploads/external-draft-actions.test.ts`

**Interfaces:**
- Consumes: `parseApkManifest`, complete app state, source-aware draft creation, and `publishVersionReplacingPreviousAction`.
- Produces button/transaction: `APK'yı yükle ve yayınla`.
- Produces final states only: `complete`, recoverable `error`, or clean cancellation; no user-visible `review`/draft state.

- [ ] **Step 1: Write failing ApkStep metadata tests**

Assert selecting either Storage or external local APK parses before hashing/upload, renders read-only package/version/SDK summary, has no manual version fields, rejects parser uncertainty before side effects, and sends exact parsed metadata to draft creation.

- [ ] **Step 2: Verify RED, then integrate Task 1 adapter**

Preserve exact `50_000_000` routing, cancellation, chunked SHA-256, ZIP magic, external URL validation, and duplicate-submit guards.

- [ ] **Step 3: Write failing wizard transaction tests**

Assert one submit stages app/assets, creates source-aware version, automatically invokes publish-replace, reaches complete without a `Yayınla` button, cleans a failed new-app attempt, preserves existing app/current version on update failure, reports cleanup-pending accurately, and allows retry without duplicate records.

- [ ] **Step 4: Implement automatic orchestration**

Remove `ReviewStep` and its manual publication state. Keep a read-only manifest/integrity summary before the single final submit. External flag failure must occur before a durable external draft remains; compensation removes candidate metadata and newly staged app/assets.

- [ ] **Step 5: Verify GREEN**

Run focused publishing/upload tests, all admin Vitest, TypeScript, ESLint, and production build.

- [ ] **Step 6: Protected commit gate**

Proposed commit: `feat(admin): automatically publish verified APKs`. Do not commit without explicit approval.

---

### Task 7: Unified Manage Page

**Files:**
- Modify: `admin/app/(dashboard)/apps/[appId]/page.tsx`
- Modify: `admin/src/features/apps/app-form.tsx`
- Modify: `admin/src/features/apps/app-list.tsx`
- Modify: `admin/src/features/versions/version-manager.tsx`
- Modify: `admin/src/features/apps/app-status-panel.tsx`
- Modify: `admin/src/features/apps/app-delete-panel.tsx`
- Modify/Create corresponding component tests.

**Interfaces:**
- Consumes Task 4 lifecycle actions and Task 6 `/publish?appId=...` update flow.
- Produces visible actions: `Bilgileri düzenle`, `Yeni APK ile güncelle`, `Yayından kaldır` or `Tekrar yayınla`, and `Kalıcı sil`.

- [ ] **Step 1: Write failing Manage-page component tests**

Assert action labels/states for active and archived apps, package/current manifest summary, update link, no draft publication controls, only the current version shown after replacement, and permanent delete isolated in the danger region.

- [ ] **Step 2: Run focused tests and verify RED**

- [ ] **Step 3: Implement the unified layout**

Reuse existing AppForm, AssetManager, ScreenshotList, and status panels rather than duplicating mutations. Rename archive copy to user-facing `Yayından kaldır`; retain accessible status and focus handling.

- [ ] **Step 4: Verify GREEN**

Run focused tests, all admin Vitest, TypeScript, ESLint, and production build.

- [ ] **Step 5: Protected commit gate**

Proposed commit: `feat(admin): unify application management actions`. Do not commit without explicit approval.

---

### Task 8: End-to-End Gates, Documentation, and Handoff

**Files:**
- Modify: `admin/e2e/admin.spec.ts`
- Modify: `admin/e2e/accessibility.spec.ts`
- Add/update local E2E fixtures for a structurally valid manifest-bearing non-installable APK.
- Modify: `admin/README.md`
- Modify: `docs/apk-release-uploader.md` only where catalog workflow changed.
- Modify: `.memory/CURRENT.md` (never commit without approval).

**Interfaces:**
- Verifies all prior task interfaces together.
- Produces local release evidence and explicit protected rollout instructions.

- [ ] **Step 1: Add E2E tests**

Cover signed-out denial, complete Storage auto-publication, external auto-publication with flag enabled in isolated local E2E only, required icon/optional screenshots, package/version extraction, successful update removing old catalog version, update failure preserving current release, unpublish/republish, typed-name permanent delete, and no user-visible drafts.

- [ ] **Step 2: Run E2E and fix only evidence-backed integration defects**

Use generated non-installable APK fixtures with valid ZIP and binary manifest structure; never weaken production validation for the existing corrupt 21-byte fixture.

- [ ] **Step 3: Update operator documentation**

Document admin account/role, required fields, manifest-derived versions, automatic publication, update replacement semantics, GitHub non-deletion, cleanup warnings, unpublish versus permanent delete, and external rollout rollback.

- [ ] **Step 4: Run the complete local release gate**

Run clean Supabase reset, all pgTAP, database lint, admin Vitest, TypeScript, ESLint, Next production build, and Playwright. Run dependency/license review, accessibility review, security review, and final code review. Record exact counts/results; do not claim success from partial commands.

- [ ] **Step 5: Update durable handoff**

Record changed files, tests, unresolved cleanup jobs, parser package versions, migration filenames, and exact next approval gate in `.memory/CURRENT.md`. Do not commit memory without approval.

- [ ] **Step 6: Protected production gates — stop for each approval**

Obtain separate explicit approval before each of: applying hosted migrations; deleting/replacing the existing `tivimate · Kod 5 · draft`; deploying admin; setting `EXTERNAL_APK_PUBLISHING_ENABLED=true`; publishing one real APK; and production physical-device smoke/rollout.

- [ ] **Step 7: Protected commit gate**

Proposed final docs/test commit only after explicit approval. No automatic push, PR, merge, deploy, publication, or cleanup of production data.
