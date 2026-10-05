# Cep Depo Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a secure, desktop-first Next.js admin panel for Cep Depo catalog publishing, APK uploads, moderation, and Auth user management.

**Architecture:** Add an independent Next.js 16 App Router application under `admin/` while keeping Supabase migrations canonical at repository root. Browser code uses only the publishable key and signed upload tokens; every privileged server action re-verifies the current admin before calling a server-only secret client. Database transitions and audit writes that must remain consistent are exposed as service-role-only RPCs.

**Tech Stack:** Next.js 16.2.9, React 19.2.3, TypeScript, Supabase JS/SSR, Zod, tus-js-client, Vitest, Testing Library, Playwright, pgTAP, Vercel

**Spec:** `docs/superpowers/specs/2026-10-05-admin-panel-design.md`

## Global Constraints

- Vercel Root Directory is `admin`; the Expo application and root package scripts remain operational.
- Only the existing `admin` role may enter; the panel never creates, assigns, or removes admin roles.
- `SUPABASE_SECRET_KEY` is server-only and must never appear in `NEXT_PUBLIC_*`, browser bundles, logs, HTML, audit metadata, or test snapshots.
- Every Server Action and privileged Route Handler calls `requireAdmin()` itself; `proxy.ts` is only an optimistic redirect/session-refresh layer.
- APK drafts are private, published APKs are public, accepted MIME types are APK/octet-stream, and the initial limit is exactly 500 MiB (`524288000` bytes).
- APK uploads go directly from the browser to Supabase resumable TUS storage with 6 MiB chunks; Vercel never proxies the file body.
- Permanent user deletion requires a suspended non-admin target and exact username confirmation; the current/last admin cannot be suspended or deleted.
- Destructive mutations are not optimistic; database/Auth/Storage internal errors are sanitized before reaching the UI.
- Production migrations and deploys require explicit user approval; no secret, signing material, credential, or SMTP password is committed.
- Preview deployments are read-only unless connected to a separate Supabase preview branch.
- Node.js 22 or later is required; do not use the deprecated `@supabase/server` framework adapters.
- New `public` tables/functions receive explicit grants; never rely on automatic Data API exposure.
- Privileged RPCs remain `SECURITY INVOKER`, set no attacker-controlled search path, revoke `PUBLIC` execution, and grant execution only to `service_role`.
- Keep Next.js same-origin Server Action protections enabled, do not widen allowed origins, do not render untrusted HTML, and emit CSP/frame/referrer/content-type security headers.
- Authenticated pages and DAL results are request-scoped and `no-store`; never place user/admin data in shared Next.js caches.

## Review Focus

- A forged direct Server Action request from a signed-in non-admin must return `FORBIDDEN` before the secret client is constructed; pinned in Task 3.
- A resumable upload that is retried after Storage succeeds but database publication fails must reuse the canonical object and remain unpublished until the retry completes; pinned in Task 6.
- Search/filter input containing wildcard characters, invalid UUIDs, or oversized text must be normalized/rejected rather than changing query semantics; pinned in Tasks 5, 7, and 8.
- Partial Auth/profile suspension state must be visible and safely retryable instead of reporting success; pinned in Task 8.
- The current or sole admin must remain protected even if a caller bypasses the UI and posts the destructive action directly; pinned in Task 8 and pgTAP coverage in Task 2.

---

### Task 1: Admin application foundation

**Files:**
- Create: `admin/package.json`
- Create: `admin/package-lock.json`
- Create: `admin/tsconfig.json`
- Create: `admin/next.config.ts`
- Create: `admin/eslint.config.mjs`
- Create: `admin/vitest.config.ts`
- Create: `admin/playwright.config.ts`
- Create: `admin/.env.example`
- Create: `admin/app/layout.tsx`
- Create: `admin/app/globals.css`
- Create: `admin/src/lib/env.ts`
- Create: `admin/src/lib/env.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: none.
- Produces: `getPublicEnv(): PublicEnv`, `getServerEnv(): ServerEnv`, shared CSS tokens, and admin scripts `lint`, `typecheck`, `test`, `test:e2e`, `build`.

- [ ] **Step 1: Create the package/config files and install the pinned dependencies**

Run: `npm --prefix admin install`
Expected: `admin/package-lock.json` is created and package installation exits 0 without changing the root lockfile.

- [ ] **Step 2: Write failing environment tests**

```ts
it('accepts an https Supabase URL and publishable key', () => {
  expect(getPublicEnv(validPublicEnv)).toEqual({ supabaseUrl, supabasePublishableKey })
})

it('rejects missing server secret without echoing supplied values', () => {
  expect(() => getServerEnv({ ...validPublicEnv, SUPABASE_SECRET_KEY: '' })).toThrow('SUPABASE_SECRET_KEY')
})
```

- [ ] **Step 3: Run the focused test and confirm the missing module failure**

Run: `npm --prefix admin test -- src/lib/env.test.ts`
Expected: FAIL because the admin package/environment module does not exist.

- [ ] **Step 4: Implement the minimal environment parser**

Pin Next `16.2.9`, React/React DOM `19.2.3`, and TypeScript-compatible test tooling. Add Zod, `@supabase/supabase-js`, `@supabase/ssr`, `server-only`, and `tus-js-client`; do not add a component framework or Tailwind. `getPublicEnv` accepts only public values; `getServerEnv` adds `SUPABASE_SECRET_KEY`, `ADMIN_READ_ONLY` (safe default `true`), `AUTH_EMAIL_ENABLED` (safe default `false`), and `NEXT_PUBLIC_SITE_URL`.

- [ ] **Step 5: Add the selected dark operations tokens and static security headers**

Define semantic colors (`--surface-*`, `--text-*`, `--accent`, `--warning`, `--danger`, `--focus`) with accessible contrast, reduced-motion handling, and visible `:focus-visible` styling. Configure `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and a strict referrer policy; Task 3 adds the request nonce CSP when `proxy.ts` exists. The root layout may build with the framework's not-found route until Task 4 adds the protected `/` dashboard; do not create a temporary `app/page.tsx` that would collide with `app/(dashboard)/page.tsx`.

- [ ] **Step 6: Verify foundation commands**

Run: `npm --prefix admin test -- src/lib/env.test.ts && npm --prefix admin run typecheck && npm --prefix admin run lint && npm --prefix admin run build`
Expected: environment tests PASS and all three build gates exit 0.

- [ ] **Step 7: Commit**

```bash
git add .gitignore admin
git commit -m "feat: scaffold admin web application"
```

### Task 2: Database authorization, audit, and transition RPCs

**Files:**
- Create via CLI: `supabase/migrations/*_admin_panel_foundation.sql`
- Create: `supabase/tests/admin_panel_rls.test.sql`
- Create: `supabase/tests/admin_panel_transitions.test.sql`
- Create: `supabase/tests/admin_panel_storage.test.sql`
- Modify: `src/types/database.types.ts`
- Create: `admin/src/types/database.types.ts`

**Interfaces:**
- Consumes: existing `user_roles`, catalog, community tables, and Storage buckets.
- Produces: `admin_audit_logs`; self-role read policy; 500 MiB `apk-drafts`; service-role-only RPCs `admin_set_review_status`, `admin_delete_hidden_review`, `admin_close_report`, `admin_set_profile_status`, `admin_publish_version`, `admin_withdraw_version`, and `admin_record_external_action`.

- [ ] **Step 1: Generate the canonical migration filename**

Run: `npx supabase migration new admin_panel_foundation`
Expected: the CLI prints one newly created timestamped `supabase/migrations/*_admin_panel_foundation.sql` path; use that exact path in all later steps and never rename its timestamp manually.

- [ ] **Step 2: Write failing pgTAP authorization and immutability tests**

```sql
select results_eq(
  $$select role::text from public.user_roles where user_id = auth.uid()$$,
  array['admin']::text[],
  'authenticated admin can read only their own role'
);
select throws_ok(
  $$delete from public.admin_audit_logs$$,
  '42501', null,
  'authenticated clients cannot mutate audit logs'
);
```

Also assert non-admin self-role reads return no admin row, cross-user roles are hidden, RPC execute privileges exclude `anon`/`authenticated`, and the actor cannot be the current/last admin for profile suspension.

- [ ] **Step 3: Write failing transition and Storage tests**

Assert report close requires a trimmed non-empty note and sets `resolved_at`; review hide/show writes one audit row; publication sets `published_at` only after draft metadata is valid; withdrawal preserves it; `apk-drafts` is private with limit `524288000` and the two exact MIME types; authenticated users have no direct draft write policy.

- [ ] **Step 4: Run the focused database tests and confirm missing-object failures**

Run: `supabase test db supabase/tests/admin_panel_rls.test.sql supabase/tests/admin_panel_transitions.test.sql supabase/tests/admin_panel_storage.test.sql`
Expected: FAIL because audit/RPC objects and the tightened bucket configuration do not exist.

- [ ] **Step 5: Implement and apply the migration locally**

Create `admin_audit_logs(id, actor_id, action, target_type, target_id, metadata, created_at)` without a target FK and enable RLS. Grant authenticated users only `SELECT` on `user_roles`; grant no client privilege on audit rows. Each `SECURITY INVOKER` transition RPC accepts `p_actor_id` and target parameters, verifies the actor still has `admin`, performs the state change plus allow-listed audit metadata in one transaction, revokes execute from `PUBLIC`/`anon`/`authenticated`, and grants execute only to `service_role`. `admin_record_external_action(p_actor_id uuid, p_action text, p_target_type text, p_target_id text, p_metadata jsonb)` accepts only the fixed Auth/Storage/catalog action allow-list and strips unknown metadata keys; it records non-transactional external operations without exposing direct audit inserts. Add indexes for audit actor/time, action/time, reports status/time, reviews moderation/time, and version status/time.

Run: `npx supabase migration up --local`
Expected: exactly the generated admin migration is applied without resetting local data.

- [ ] **Step 6: Run full database verification and regenerate both type files**

Run: `npm run db:test`
Expected: all existing and new pgTAP files PASS.

Run: `npm run db:types`
Expected: root generated types include the new table and RPCs; copy the identical generated type to `admin/src/types/database.types.ts`.

- [ ] **Step 7: Verify advisors and diff hygiene**

Run: `supabase db lint --local && git diff --check`
Expected: no new advisor errors and no whitespace errors.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations supabase/tests src/types/database.types.ts admin/src/types/database.types.ts
git commit -m "feat: add admin authorization and audit foundation"
```

### Task 3: SSR session and server authorization boundary

**Files:**
- Create: `admin/src/lib/supabase/browser.ts`
- Create: `admin/src/lib/supabase/server.ts`
- Create: `admin/src/server/auth/require-admin.ts`
- Create: `admin/src/server/auth/require-admin.test.ts`
- Create: `admin/src/server/supabase/admin-client.ts`
- Create: `admin/src/server/errors/action-error.ts`
- Create: `admin/src/server/errors/action-error.test.ts`
- Create: `admin/src/server/http/assert-same-origin.ts`
- Create: `admin/src/server/http/assert-same-origin.test.ts`
- Create: `admin/proxy.ts`

**Interfaces:**
- Consumes: Task 1 env readers and Task 2 self-role policy/types.
- Produces: `requireAdmin(): Promise<AdminIdentity>`, `getAdminClient(identity: AdminIdentity): SupabaseClient<Database>`, `ActionResult<T>`, and `toActionError(error): ActionError`.

- [ ] **Step 1: Write failing authorization-boundary tests**

```ts
it('rejects a non-admin before constructing the secret client', async () => {
  await expect(requireAdmin(depsFor(nonAdmin))).rejects.toMatchObject({ code: 'FORBIDDEN' })
  expect(createSecretClient).not.toHaveBeenCalled()
})

it('returns the verified actor id for an admin claim and self-role row', async () => {
  await expect(requireAdmin(depsFor(admin))).resolves.toEqual({ userId: adminId })
})
```

Cover signed-out, malformed `sub`, role-query error, forged cross-user role data, `ADMIN_READ_ONLY=true` mutation rejection, and cross-origin POST rejection before authorization.

- [ ] **Step 2: Run focused tests and confirm missing-module failures**

Run: `npm --prefix admin test -- src/server/auth src/server/errors`
Expected: FAIL because auth/error modules are absent.

- [ ] **Step 3: Implement request-scoped SSR clients and optimistic proxy refresh**

Use `createServerClient` with `cookies().getAll/setAll`, a fresh client per request, and `auth.getClaims()` for verified claims. Mark authenticated layouts/DAL calls dynamic and no-store. `proxy.ts` refreshes the session, generates a per-request CSP nonce for Next scripts, emits a restrictive CSP including `frame-ancestors 'none'`, and redirects obvious signed-out requests, but performs no privileged data mutation. `assertSameOrigin(request)` compares parsed origins against `NEXT_PUBLIC_SITE_URL` for custom POST Route Handlers; do not accept caller-controlled forwarding headers.

- [ ] **Step 4: Implement the branded authorization token and secret client**

`AdminIdentity` is created only by `requireAdmin`; `getAdminClient` requires it as an argument and lives behind `import 'server-only'`. Configure the secret client with `persistSession:false`, `autoRefreshToken:false`, and `detectSessionInUrl:false`.

- [ ] **Step 5: Implement sanitized action errors**

Expose only stable codes `UNAUTHENTICATED`, `FORBIDDEN`, `READ_ONLY`, `VALIDATION`, `CONFLICT`, `NOT_FOUND`, `TEMPORARY`, `INTERNAL`; map unknown Supabase/Postgres/Auth details to Turkish safe copy and a generated correlation ID.

- [ ] **Step 6: Verify tests and browser bundle boundary**

Run: `npm --prefix admin test -- src/server/auth src/server/errors src/server/http && npm --prefix admin run build`
Expected: tests PASS; build exits 0 and no client component imports `admin-client.ts`.

- [ ] **Step 7: Commit**

```bash
git add admin/src admin/proxy.ts
git commit -m "feat: secure admin server authorization"
```

### Task 4: Login, protected shell, and dashboard

**Files:**
- Create: `admin/app/(auth)/login/page.tsx`
- Create: `admin/app/(auth)/login/actions.ts`
- Create: `admin/app/(dashboard)/layout.tsx`
- Create: `admin/app/(dashboard)/page.tsx`
- Create: `admin/src/components/navigation/sidebar.tsx`
- Create: `admin/src/components/status/status-badge.tsx`
- Create: `admin/src/features/dashboard/dashboard-dal.ts`
- Create: `admin/src/features/dashboard/dashboard.test.tsx`
- Create: `admin/src/features/auth/login.test.tsx`

**Interfaces:**
- Consumes: `requireAdmin`, public SSR client, `ActionResult<T>`.
- Produces: `loginAction`, `logoutAction`, `getDashboardSummary(): Promise<DashboardSummary>`, and the protected dark operations shell.

- [ ] **Step 1: Write failing login and dashboard component tests**

```tsx
it('shows a generic error for invalid credentials without echoing email', async () => {})
it('links each dashboard count to its filtered work queue', async () => {})
it('marks the active sidebar destination with text and aria-current', async () => {})
```

Assert signed-in non-admins see an access-denied page rather than dashboard data.

- [ ] **Step 2: Run focused tests and confirm failures**

Run: `npm --prefix admin test -- src/features/auth src/features/dashboard`
Expected: FAIL because routes/components do not exist.

- [ ] **Step 3: Implement login/logout actions and protected layout**

Validate email/password with Zod, call `signInWithPassword`, then verify admin before redirecting. Logout clears the Supabase session. The layout rechecks `requireAdmin()` and renders semantic nav/main landmarks.

- [ ] **Step 4: Implement dashboard DAL and UI**

Return open reports, hidden reviews, suspended profiles, draft versions, oldest open reports, and incomplete publish operations. Query with the secret client only after authorization; cap priority lists to ten rows.

- [ ] **Step 5: Verify focused and app-wide gates**

Run: `npm --prefix admin test -- src/features/auth src/features/dashboard && npm --prefix admin run typecheck && npm --prefix admin run lint`
Expected: tests PASS and static gates exit 0.

- [ ] **Step 6: Commit**

```bash
git add admin/app admin/src/components admin/src/features/auth admin/src/features/dashboard
git commit -m "feat: add admin login and operations dashboard"
```

### Task 5: Category and application management

**Files:**
- Create: `admin/app/(dashboard)/apps/page.tsx`
- Create: `admin/app/(dashboard)/apps/new/page.tsx`
- Create: `admin/app/(dashboard)/apps/[appId]/page.tsx`
- Create: `admin/src/features/apps/app-schema.ts`
- Create: `admin/src/features/apps/app-schema.test.ts`
- Create: `admin/src/features/apps/app-dal.ts`
- Create: `admin/src/features/apps/app-actions.ts`
- Create: `admin/src/features/apps/app-form.tsx`
- Create: `admin/src/features/apps/app-list.tsx`
- Create: `admin/src/features/apps/asset-actions.ts`
- Create: `admin/src/features/apps/app-actions.test.ts`
- Create: `admin/src/components/tables/pagination.tsx`
- Create: `admin/src/lib/search-params.ts`
- Create: `admin/src/lib/search-params.test.ts`

**Interfaces:**
- Consumes: authorization/action result, catalog generated types.
- Produces: `parseListParams`, `listApps`, `getApp`, `createAppAction`, `updateAppAction`, `setAppStatusAction`, category CRUD actions, and signed icon/screenshot upload plus metadata actions.

- [ ] **Step 1: Write failing validator and query-input tests**

```ts
it.each(['%', '_', 'not-a-uuid', 'x'.repeat(201)])('does not pass unsafe search input to the DAL: %s', value => {})
it('normalizes a valid slug and enforces the database text bounds', () => {})
it('never accepts download_count from form data', () => {})
```

- [ ] **Step 2: Write failing authorization/action tests**

Assert every action calls `requireAdmin`, invalid category IDs fail before mutation, unique slug conflicts map to `CONFLICT`, archive is explicit, asset upload paths are generated server-side, image MIME/10 MiB limits match `app-assets`, and audit metadata contains IDs/status but no descriptions.

- [ ] **Step 3: Run focused tests and confirm failures**

Run: `npm --prefix admin test -- src/features/apps src/lib/search-params.test.ts`
Expected: FAIL because app modules are absent.

- [ ] **Step 4: Implement validated paginated DAL and mutations**

Use a fixed sort allow-list and escaped literal search; default page size 25, maximum 100. Use exact database limits from existing constraints. Server creates IDs/paths; form input cannot set counters, timestamps, creator, or audit fields. Catalog mutations call `admin_record_external_action` after success and expose a retryable operations warning if audit recording fails.

- [ ] **Step 5: Implement list/detail/forms and safe confirmations**

Keep filters in URL query parameters. Use real table headers, labelled controls, field-linked errors, status text, and a separate archive confirmation panel. Add category editing and signed direct uploads for icon/screenshots, with screenshot alt text/order on the app detail page.

- [ ] **Step 6: Verify the feature**

Run: `npm --prefix admin test -- src/features/apps src/lib/search-params.test.ts && npm --prefix admin run typecheck && npm --prefix admin run lint`
Expected: focused tests PASS and static gates exit 0.

- [ ] **Step 7: Commit**

```bash
git add admin/app/'(dashboard)'/apps admin/src/features/apps admin/src/components/tables admin/src/lib/search-params*
git commit -m "feat: manage admin catalog records"
```

### Task 6: Resumable APK upload and version publication

**Files:**
- Create: `admin/app/(dashboard)/apps/[appId]/versions/new/page.tsx`
- Create: `admin/app/api/uploads/sign/route.ts`
- Create: `admin/src/features/uploads/upload-schema.ts`
- Create: `admin/src/features/uploads/hash-file.ts`
- Create: `admin/src/features/uploads/tus-upload.ts`
- Create: `admin/src/features/uploads/upload-wizard.tsx`
- Create: `admin/src/features/uploads/upload-actions.ts`
- Create: `admin/src/features/uploads/upload-dal.ts`
- Create: `admin/src/features/uploads/orphan-cleanup.ts`
- Create: `admin/src/features/uploads/upload.test.ts`
- Create: `admin/src/features/versions/version-actions.ts`
- Create: `admin/src/features/versions/version-actions.test.ts`

**Interfaces:**
- Consumes: Task 2 version RPCs, Task 3 authorization, Task 5 app detail.
- Produces: `createUploadIntentAction`, `finalizeUploadAction`, `publishVersionAction`, `withdrawVersionAction`, `listOrphanUploads`, `cleanupOrphanUploadAction`, `hashFile(file,onProgress)`, and `startTusUpload(intent,file,callbacks)`.

- [ ] **Step 1: Write failing upload contract tests**

```ts
it('rejects files above 524288000 bytes before requesting a token', async () => {})
it('uses 6 MiB TUS chunks and resumes the prior fingerprint', async () => {})
it('generates draft paths server-side and ignores client bucket/path fields', async () => {})
it('rejects non-PK magic bytes and mismatched object size during finalize', async () => {})
it('lists and deletes only server-recognized orphan paths with an audit record', async () => {})
```

- [ ] **Step 2: Write the idempotent publication regression test**

Model Storage copy success followed by RPC failure; assert the first call returns `TEMPORARY` with draft unchanged, the retry detects/reuses the existing canonical object, calls publication once, and only then returns `published`.

- [ ] **Step 3: Run focused tests and confirm failures**

Run: `npm --prefix admin test -- src/features/uploads src/features/versions`
Expected: FAIL because upload/version modules are absent.

- [ ] **Step 4: Implement signed upload intents and client hashing/TUS**

The same-origin POST Route Handler calls `assertSameOrigin` and `requireAdmin`, then creates an operation UUID and draft path, stores no caller-provided path, and returns a short-lived signed token. Hash incrementally in a Web Worker-compatible helper. Configure direct Storage TUS endpoint, exact MIME allow-list, 6 MiB chunks, retry delays, progress events, and prior-upload resumption.

- [ ] **Step 5: Implement finalize and idempotent publish/withdraw**

Finalize rechecks admin, Storage object metadata, size, MIME, and a ranged read for `PK`, then creates the draft row with canonical app/version IDs. Publish copies/moves to `apps/<app-id>/versions/<version-id>.apk`, tolerates an already-identical destination, then calls `admin_publish_version`. Never mark published before canonical object verification.

- [ ] **Step 6: Implement the four-step accessible wizard**

Expose file/metadata, hash, resumable progress, and final review states; announce progress through a throttled live region; warn on navigation during active upload; on narrow screens show the approved desktop warning rather than enabling publish. Show recognized orphan draft/public objects in an operations panel and require explicit audited cleanup; never delete unknown paths automatically.

- [ ] **Step 7: Verify upload gates**

Run: `npm --prefix admin test -- src/features/uploads src/features/versions && npm --prefix admin run typecheck && npm --prefix admin run lint && npm --prefix admin run build`
Expected: focused tests PASS and production build exits 0.

- [ ] **Step 8: Commit**

```bash
git add admin/app/'(dashboard)'/apps admin/app/api/uploads admin/src/features/uploads admin/src/features/versions
git commit -m "feat: publish APK versions from admin"
```

### Task 7: Review and report moderation

**Files:**
- Create: `admin/app/(dashboard)/reviews/page.tsx`
- Create: `admin/app/(dashboard)/reports/page.tsx`
- Create: `admin/app/(dashboard)/reports/[reportId]/page.tsx`
- Create: `admin/src/features/reviews/review-dal.ts`
- Create: `admin/src/features/reviews/review-actions.ts`
- Create: `admin/src/features/reviews/review-actions.test.ts`
- Create: `admin/src/features/reports/report-schema.ts`
- Create: `admin/src/features/reports/report-dal.ts`
- Create: `admin/src/features/reports/report-actions.ts`
- Create: `admin/src/features/reports/report-actions.test.ts`

**Interfaces:**
- Consumes: Task 2 moderation RPCs, shared pagination, authorization/error boundary.
- Produces: `listReviews`, `setReviewVisibilityAction`, `deleteHiddenReviewAction`, `listReports`, `getReport`, and `closeReportAction`.

- [ ] **Step 1: Write failing moderation tests**

```ts
it('requires hidden status before permanent review deletion', async () => {})
it.each(['', '   ', 'x'.repeat(2001)])('rejects an invalid admin note: %j', async note => {})
it('closes an open report exactly once with trimmed note and audit data', async () => {})
```

Also cover wildcard/oversized filters, invalid report UUID, closed-report conflict, and comment body exclusion from audit/log metadata.

- [ ] **Step 2: Run focused tests and confirm failures**

Run: `npm --prefix admin test -- src/features/reviews src/features/reports`
Expected: FAIL because moderation modules are absent.

- [ ] **Step 3: Implement review moderation**

List by user/app/date/rating/status with URL-backed pagination. Hide/show through the RPC. Permanent delete requires a second confirmation and re-fetches current hidden status server-side before deletion/audit.

- [ ] **Step 4: Implement report resolution**

List by target/reason/status/date, show the app/version/reporter context, and close only from `open` to `resolved` or `dismissed` with a trimmed note. Do not implement reopen.

- [ ] **Step 5: Verify moderation gates**

Run: `npm --prefix admin test -- src/features/reviews src/features/reports && npm --prefix admin run typecheck && npm --prefix admin run lint`
Expected: focused tests PASS and static gates exit 0.

- [ ] **Step 6: Commit**

```bash
git add admin/app/'(dashboard)'/reviews admin/app/'(dashboard)'/reports admin/src/features/reviews admin/src/features/reports
git commit -m "feat: add community moderation tools"
```

### Task 8: Full Auth user management

**Files:**
- Create: `admin/app/(dashboard)/users/page.tsx`
- Create: `admin/app/(dashboard)/users/[userId]/page.tsx`
- Create: `admin/src/features/users/user-schema.ts`
- Create: `admin/src/features/users/user-dal.ts`
- Create: `admin/src/features/users/user-actions.ts`
- Create: `admin/src/features/users/user-actions.test.ts`
- Create: `admin/src/features/users/user-list.tsx`
- Create: `admin/src/features/users/user-detail.tsx`

**Interfaces:**
- Consumes: Auth Admin API, `admin_set_profile_status`, authorization/error boundary.
- Produces: `listManagedUsers`, `getManagedUser`, `suspendUserAction`, `activateUserAction`, `requestRecoveryAction`, and `deleteUserAction`.

- [ ] **Step 1: Write failing list and input-boundary tests**

```ts
it.each(['%', '_', 'x'.repeat(321)])('normalizes or rejects unsafe user search: %s', async value => {})
it('joins paginated Auth users to profiles without exposing auth metadata blobs', async () => {})
it('reports profile/auth suspension mismatch as partial state', async () => {})
```

- [ ] **Step 2: Write failing destructive-boundary tests**

```ts
it('rejects direct self-suspension before Auth admin mutation', async () => {})
it('rejects suspension or deletion of the sole admin', async () => {})
it('requires suspended profile and exact normalized username before hard delete', async () => {})
it('does not report success when Auth ban succeeds but profile transition fails', async () => {})
```

- [ ] **Step 3: Run focused tests and confirm failures**

Run: `npm --prefix admin test -- src/features/users`
Expected: FAIL because user-management modules are absent.

- [ ] **Step 4: Implement user listing and detail aggregation**

Use `auth.admin.listUsers({page,perPage})`, then fetch profiles and aggregate counts only for returned IDs. Expose email confirmation, creation/last sign-in, username/avatar/status, ban state, counts, and an explicit consistency state; never return raw app/user metadata or password fields.

- [ ] **Step 5: Implement suspend/activate with retryable partial states**

Recheck target roles and actor on every action. Suspension uses Auth ban plus profile RPC; activation removes ban plus restores profile. Return an operation result describing `authUpdated`, `profileUpdated`, and retry action when only one side succeeds; audit each completed transition without pretending atomicity.

- [ ] **Step 6: Implement recovery and permanent deletion**

Recovery calls `auth.resetPasswordForEmail(email, { redirectTo: 'cepdepo://auth/reset-password' })` only when `AUTH_EMAIL_ENABLED=true`, then audits the request without storing the email. Hard delete uses `auth.admin.deleteUser(userId,false)` only after all guards, then best-effort removes avatar and records target UUID without copied personal content.

- [ ] **Step 7: Implement accessible desktop-first user UI**

Separate ordinary actions from the danger zone, require typed username, never default focus to delete, and show irreversible effects. Narrow screens may inspect but must block permanent deletion with the approved desktop message.

- [ ] **Step 8: Verify user-management gates**

Run: `npm --prefix admin test -- src/features/users && npm --prefix admin run typecheck && npm --prefix admin run lint && npm --prefix admin run build`
Expected: focused tests PASS and production build exits 0.

- [ ] **Step 9: Commit**

```bash
git add admin/app/'(dashboard)'/users admin/src/features/users
git commit -m "feat: manage Supabase Auth users"
```

### Task 9: End-to-end accessibility, security, and regression gate

**Files:**
- Create: `admin/e2e/auth.setup.ts`
- Create: `admin/e2e/admin.spec.ts`
- Create: `admin/e2e/access-control.spec.ts`
- Create: `admin/e2e/accessibility.spec.ts`
- Create: `admin/e2e/fixtures/test.apk`
- Create: `admin/src/server/observability/logger.ts`
- Create: `admin/src/server/observability/logger.test.ts`
- Modify: `README.md`
- Modify: `admin/package.json`

**Interfaces:**
- Consumes: all admin features.
- Produces: critical browser regression suite, sanitized structured logger, local admin runbook.

- [ ] **Step 1: Write failing logger redaction tests**

Assert correlation ID, operation, actor UUID, target UUID/type, duration, and error class remain; password, bearer token, secret key, comment body, report description, and APK bytes are removed.

- [ ] **Step 2: Add Playwright setup and critical flow tests**

Cover admin login/logout, non-admin denial, app creation, draft upload with a small APK fixture, finalize/publish, review hide/show, report resolve/dismiss, user suspend/activate, and all user-delete barriers. Each test cleans up its own records without database reset.

- [ ] **Step 3: Add keyboard/accessibility browser tests**

Verify landmarks/headings, visible focus, keyboard navigation, labelled fields, linked validation errors, table headers, text status labels, live upload progress, focus restoration, and safe destructive-dialog focus.

- [ ] **Step 4: Run the end-to-end suite and fix only evidenced failures**

Run: `npm --prefix admin run test:e2e`
Expected: all Chromium tests PASS with zero console errors.

- [ ] **Step 5: Run complete local release gates**

Run: `npm --prefix admin test && npm --prefix admin run typecheck && npm --prefix admin run lint && npm --prefix admin run build && npm --prefix admin run test:e2e`
Expected: all admin gates PASS.

Run: `npm test -- --runInBand && npm run typecheck && npm run lint && npm run db:test && supabase db lint --local && git diff --check`
Expected: mobile regression, full pgTAP, advisor, and diff checks PASS.

- [ ] **Step 6: Document local setup and operations**

Document `admin/.env.local`, local Supabase URL/key use, no-secret rules, test commands, Vercel root, read-only preview behavior, upload cleanup, user partial-state recovery, and SMTP limitation.

- [ ] **Step 7: Commit**

```bash
git add admin README.md
git commit -m "test: verify admin production workflows"
```

### Task 10: Hosted migration and Vercel production release

**Files:**
- Modify: `README.md`
- Modify: `.memory/CURRENT.md` (do not commit without explicit approval)

**Interfaces:**
- Consumes: completed Tasks 1–9 and explicit deployment approval.
- Produces: hosted migration state, Vercel production deployment URL, smoke-test evidence, rollback record.

- [ ] **Step 1: Verify hosted target and migration plan without mutation**

Run the Supabase project identity/migration-list commands and a database push dry run. Confirm project ref is exactly `otksmbcuopinlecrfobe`, only the admin migration is pending, and no destructive statement targets legacy data.

- [ ] **Step 2: Obtain explicit approval, then apply the hosted migration**

Do not infer approval from prior mobile migrations. After approval, push once, confirm local/remote migration history match, regenerate hosted database types if needed, and run Supabase advisors.

- [ ] **Step 3: Configure Vercel without printing values**

Set Root Directory `admin` and presence-check `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_READ_ONLY=false`, and `AUTH_EMAIL_ENABLED` (keep `false` until SMTP delivery is verified). Preview must use `ADMIN_READ_ONLY=true` unless a separate branch is configured.

- [ ] **Step 4: Deploy production after explicit approval**

Run the Vercel production deployment from `admin/`. Record deployment ID/URL and previous deployment ID for rollback; do not expose environment values.

- [ ] **Step 5: Perform physical smoke tests**

Verify existing admin login, dashboard counts, read-only lists, one reversible review hide/show, one report test record resolution, one draft upload/publish/withdraw fixture, user self-protection, and matching audit rows. Do not hard-delete a real user.

- [ ] **Step 6: Verify rollback and close the runbook**

Confirm the previous Vercel deployment can be promoted, published APK withdrawal works, and database changes require forward-fix rather than rollback. Update README and `.memory/CURRENT.md` with actual evidence, known SMTP limitation, deployment URL, and next action.

- [ ] **Step 7: Commit release documentation only after approval**

```bash
git add README.md
git commit -m "docs: add admin production runbook"
```

Do not add `.memory/CURRENT.md` to the commit unless the user explicitly approves committing project memory.
