# Cep Depo Accounts and Community Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure email/password accounts, profiles, avatars, ratings, optional-text reviews and app/version reports to Cep Depo, then produce a shareable production APK connected to hosted Supabase.

**Architecture:** Preserve the feature-oriented Expo structure: route files compose focused screens, repositories own Supabase calls, mappers isolate generated database rows, TanStack Query owns server state, and a single `AuthProvider` owns session state. An imperative Supabase migration adds community data, explicit grants, RLS, Storage policies and aggregate views; authorization remains in the database rather than UI visibility.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19, Expo Router, TypeScript 6 strict mode, Supabase JS 2.117, TanStack Query 5, AsyncStorage, Expo Image Picker, Jest/jest-expo, React Native Testing Library, Supabase CLI, PostgreSQL 17 and pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-01-accounts-community-design.md`

## Global Constraints

- Android package remains `com.cepdepo.app`; URL scheme remains `cepdepo`; existing signing identity must be preserved.
- Anonymous catalog browsing and APK downloading must continue to work when auth is unavailable or signed out.
- Registration takes username, email, password and password confirmation in one flow; community writes require a confirmed email and `active` profile.
- Usernames are case-insensitively unique, 3–30 characters, and match `^[A-Za-zÇĞİÖŞÜçğıöşü0-9]+(?:[._][A-Za-zÇĞİÖŞÜçğıöşü0-9]+)*$`.
- A user has at most one review per app; rating is 1–5; review body is optional and, when present, 3–2000 trimmed characters.
- New reviews default to `visible`; only visible reviews contribute to public lists, count and average.
- Report reasons are `acilmiyor`, `link_bozuk`, `sahte_uygulama` and `diger`; a reporter can have only one open report per app/version target.
- Avatars accept PNG, JPEG and WebP up to 5 MB and are writable only below `<auth-user-id>/`.
- Every exposed table has RLS and explicit grants; `TO authenticated` without ownership and account-state checks is forbidden.
- Never use `raw_user_meta_data` for authorization; never expose a service-role/secret key in mobile code or `EXPO_PUBLIC_*`.
- Google Play/AAB, follows, notifications, push, admin UI, account deletion, social login and mobile APK publishing are out of scope.
- Use `npx expo install` for Expo/native dependencies and regenerate `src/types/database.types.ts` after schema changes.
- User-facing copy is Turkish; raw Supabase, SQL, constraint and token details never reach UI or logs.

## Review Focus

- Duplicate usernames racing between availability check and signup must resolve to a safe Turkish field error, not a raw trigger/database error — pinned in Task 3.
- Auth callbacks with malformed schemes, missing credentials or reused/expired codes must not create a session or leak callback data — pinned in Task 2.
- A signed-in but unconfirmed or suspended user must remain able to browse while every community write is rejected by RLS — pinned in Task 1 and surfaced in Task 4.
- Review mutations must refresh detail summary/list and account history without clearing anonymous catalog data — pinned in Task 6 and Task 7.
- Avatar upload success followed by profile update failure must attempt cleanup while preserving the previous avatar reference — pinned in Task 5.

## Planned File Structure

```text
app/
  _layout.tsx
  (tabs)/account.tsx
  auth/sign-in.tsx
  auth/sign-up.tsx
  auth/forgot-password.tsx
  auth/confirm.tsx
  auth/reset-password.tsx
src/
  components/ui/FormField.tsx
  providers/AppProviders.tsx
  providers/AuthProvider.tsx
  features/auth/
    auth.types.ts
    auth.validation.ts
    auth.errors.ts
    auth.repository.ts
    auth-links.ts
    auth-context.ts
    SignInScreen.tsx
    SignUpScreen.tsx
    ForgotPasswordScreen.tsx
    ConfirmEmailScreen.tsx
    ResetPasswordScreen.tsx
  features/profile/
    profile.types.ts
    profile.mapper.ts
    profile.repository.ts
    profile.queries.ts
    avatar-upload.ts
    AccountScreen.tsx
    ProfileEditor.tsx
  features/reviews/
    review.types.ts
    review.mapper.ts
    review.repository.ts
    review.queries.ts
    RatingSummary.tsx
    StarRatingInput.tsx
    ReviewForm.tsx
    ReviewList.tsx
    ReviewsSection.tsx
  features/reports/
    report.types.ts
    report.validation.ts
    report.repository.ts
    report.queries.ts
    ReportSheet.tsx
  lib/supabase.ts
  types/database.types.ts
supabase/
  config.toml
  migrations/<generated>_accounts_community.sql
  seed.sql
  tests/accounts_community_rls.test.sql
  tests/accounts_community_functions.test.sql
  tests/accounts_community_storage.test.sql
tests/
  providers/AuthProvider.test.tsx
  routes/account.test.tsx
  features/auth/*.test.ts(x)
  features/profile/*.test.ts(x)
  features/reviews/*.test.ts(x)
  features/reports/*.test.ts(x)
```

---

### Task 1: Community Schema, Constraints, RLS and Storage

**Files:**
- Create with `npx supabase migration new accounts_community`: `supabase/migrations/<generated>_accounts_community.sql`
- Create: `supabase/tests/accounts_community_rls.test.sql`
- Create: `supabase/tests/accounts_community_functions.test.sql`
- Create: `supabase/tests/accounts_community_storage.test.sql`
- Modify: `supabase/config.toml`
- Modify: `supabase/seed.sql`
- Regenerate: `src/types/database.types.ts`

**Interfaces:**
- Consumes: existing `apps(id, status)`, `app_versions(id, app_id, status)`, `auth.users` and `avatars` bucket.
- Produces: `profiles`, `reviews`, `reports`, `review_rating_summaries`; enums `profile_status`, `review_moderation_status`, `report_reason`, `report_status`; `private.can_write_community()`; generated database types used by Tasks 3, 5, 6 and 8.

- [ ] **Step 1: Create failing pgTAP coverage before the migration**

Add named tests proving: profile creation from valid signup metadata; invalid/duplicate username rejection; public visible-review reads; own-row review CRUD; no moderation-field escalation; one review per app; rating/body constraints; own report insert/read; app/version pairing; one open report per target; anonymous/unconfirmed/suspended/cross-user write rejection; visible-only aggregate count/average; explicit grants; avatar public read and own-prefix-only write/update/delete.

- [ ] **Step 2: Run database tests to verify the new suites fail**

Run: `npm run db:start`, then `npm run db:test`

Expected: FAIL because community relations and policies do not exist.

- [ ] **Step 3: Create the imperative migration through the CLI**

Run: `npx supabase migration new accounts_community`

Expected: one timestamped SQL file; use that generated path for every later step and commit command.

- [ ] **Step 4: Implement enums, tables, constraints and indexes in the generated migration**

Create the exact columns and values from the spec. Use a composite FK for `reports(version_id, app_id)`, a partial unique index for open report targets (with separate app-only and version-target predicates so `NULL` cannot bypass uniqueness), and indexes for every FK/RLS/list path. Normalize blank review/report text to `NULL` through write functions or checks that enforce trimmed values; do not silently retain whitespace-only strings.

- [ ] **Step 5: Implement profile creation and account-state authorization**

Create `private` schema if absent. Add an `auth.users` insert trigger that validates `raw_user_meta_data->>'username'` and inserts `profiles`; add `private.can_write_community()` returning boolean from the current `auth.uid()`, `auth.users.email_confirmed_at` and `profiles.status`. Fix `search_path`; revoke default `PUBLIC`/anon/service-role execution, grant only the authenticated role what policy evaluation requires, and keep `private` outside exposed API schemas. Ensure clients cannot supply another user identity or status.

- [ ] **Step 6: Add public review summary and all RLS/grants**

Create `review_rating_summaries` with `security_invoker = true`, reading only active apps and visible reviews. Add explicit grants, column-scoped update grants and policies for public reads, owner writes, immutable ownership/moderation/admin fields, active published report targets and service-role management. Wrap stable auth helpers in scalar subqueries in policies and index policy predicates.

- [ ] **Step 7: Harden the existing `avatars` bucket and policies**

Set it public with 5 MB and PNG/JPEG/WebP restrictions. Add policies that match the first storage folder to `(select auth.uid())::text`, require `private.can_write_community()` for writes, and grant only required object operations. Cover upsert’s INSERT/SELECT/UPDATE requirements and own-path DELETE.

- [ ] **Step 8: Enable local email confirmation and seed deterministic community fixtures**

Set `auth.email.enable_confirmations = true`; add both `cepdepo://auth/confirm` and `cepdepo://auth/reset-password` to local redirect allow-list. Extend seed data only with deterministic visible review/profile fixtures needed for manual UI work; never seed production credentials.

- [ ] **Step 9: Reset, test, inspect advisors and regenerate types**

Run: `npm run db:reset`, `npm run db:test`, `npx supabase db advisors --local`, `npm run db:types`

Expected: reset succeeds; all pgTAP suites pass; no new security advisor error; generated types contain every interface listed above.

- [ ] **Step 10: Run TypeScript checks for generated-type fallout**

Run: `npm run typecheck`

Expected: PASS before application code consumes the new types.

- [ ] **Step 11: Commit the database contract**

```bash
git add supabase/config.toml supabase/seed.sql supabase/migrations/*_accounts_community.sql supabase/tests/accounts_community_*.test.sql src/types/database.types.ts
git commit -m "feat: add secure community database schema"
```

### Task 2: Auth Client Lifecycle, Provider and Deep Links

**Files:**
- Create: `src/features/auth/auth.types.ts`
- Create: `src/features/auth/auth-context.ts`
- Create: `src/features/auth/auth-links.ts`
- Create: `src/providers/AuthProvider.tsx`
- Modify: `src/lib/supabase.ts`
- Modify: `src/providers/AppProviders.tsx`
- Modify: `app/_layout.tsx`
- Create: `tests/features/auth/auth-links.test.ts`
- Create: `tests/providers/AuthProvider.test.tsx`

**Interfaces:**
- Consumes: `getSupabaseClient(): SupabaseClient<Database>`, AsyncStorage and Expo Linking.
- Produces: `AuthState = { status: 'loading' | 'signedOut' | 'signedIn'; session: Session | null; user: User | null }`; `useAuth(): AuthContextValue`; `handleAuthCallback(url: string, client: SupabaseClient<Database>): Promise<'confirmed' | 'recovery' | 'ignored'>`.

- [ ] **Step 1: Write failing callback parser tests**

Cover valid `cepdepo://auth/confirm` and `/reset-password` callbacks, PKCE `code` exchange, legacy access/refresh token session setup if Supabase emits token fragments, wrong scheme/host, missing credentials, callback error parameters, reused/expired code errors and redaction (thrown errors must not contain URL/token values).

- [ ] **Step 2: Run callback tests and verify failure**

Run: `npm test -- --runTestsByPath tests/features/auth/auth-links.test.ts`

Expected: FAIL because `auth-links.ts` does not exist.

- [ ] **Step 3: Implement auth callback handling**

Implement the exported signature above. Accept only the two exact app targets; call `exchangeCodeForSession(code)` for PKCE or `setSession({ access_token, refresh_token })` for token callbacks; map recovery callbacks to `recovery`; return `ignored` for unrelated links; throw sanitized domain errors for expected auth failures.

- [ ] **Step 4: Write failing provider lifecycle tests**

Assert initial `getSession`, subscription/unsubscription to `onAuthStateChange`, `startAutoRefresh()` only while React Native `AppState` is active, `stopAutoRefresh()` otherwise, signed-out fallback after refresh/session failure, and preservation of child rendering while signed out.

- [ ] **Step 5: Run provider tests and verify failure**

Run: `npm test -- --runTestsByPath tests/providers/AuthProvider.test.tsx`

Expected: FAIL because `AuthProvider` and `useAuth` do not exist.

- [ ] **Step 6: Implement provider and client lifecycle**

Keep `detectSessionInUrl: false`, persistent AsyncStorage sessions and automatic refresh configuration. `AuthProvider` accepts optional injected `client` for tests, owns AppState and auth subscriptions, exposes only the typed context, and does not block public children after initial session resolution.

- [ ] **Step 7: Wire providers and root deep-link subscription**

Place `AuthProvider` inside `QueryClientProvider`. Handle both initial URL and runtime Linking events once; navigate only after `handleAuthCallback` returns `confirmed` or `recovery`. Do not put auth callback parsing in route components.

- [ ] **Step 8: Run targeted and baseline tests**

Run: `npm test -- --runTestsByPath tests/features/auth/auth-links.test.ts tests/providers/AuthProvider.test.tsx tests/features/bootstrap/BootstrapGate.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit auth infrastructure**

```bash
git add app/_layout.tsx src/lib/supabase.ts src/providers src/features/auth/auth.types.ts src/features/auth/auth-context.ts src/features/auth/auth-links.ts tests/providers tests/features/auth/auth-links.test.ts
git commit -m "feat: add mobile auth session infrastructure"
```

### Task 3: Auth Validation, Repository and Safe Errors

**Files:**
- Create: `src/features/auth/auth.validation.ts`
- Create: `src/features/auth/auth.errors.ts`
- Create: `src/features/auth/auth.repository.ts`
- Create: `tests/features/auth/auth.validation.test.ts`
- Create: `tests/features/auth/auth.repository.test.ts`

**Interfaces:**
- Consumes: Supabase Auth client and Task 1’s `profiles` contract.
- Produces: `validateUsername(value: string): string | null`; `validateEmail(value: string): string | null`; `validatePassword(value: string): string | null`; `mapAuthError(error: unknown, field?: 'username' | 'email' | 'password'): AuthFormError`; `AuthRepository` methods `signUp(input: { username: string; email: string; password: string }): Promise<'confirmationRequired'>`, `signIn(email: string, password: string): Promise<void>`, `signOut(): Promise<void>`, `resendConfirmation(email: string): Promise<void>`, `requestPasswordReset(email: string): Promise<void>`, `updatePassword(password: string): Promise<void>`, `isUsernameAvailable(username: string): Promise<boolean>`.

- [ ] **Step 1: Write failing validation and error-mapping tests**

Pin username boundaries/allowed separators/Turkish letters, normalized email, password confirmation mismatch, duplicate username codes/messages, invalid credentials, rate limits, offline failures and unknown errors. Assert returned copy is Turkish and excludes SQL names, Supabase URLs and raw messages.

- [ ] **Step 2: Run validation tests and verify failure**

Run: `npm test -- --runTestsByPath tests/features/auth/auth.validation.test.ts`

Expected: FAIL because validation/error modules do not exist.

- [ ] **Step 3: Implement pure validators and safe error mapping**

Return field-specific errors without throwing for user input. Keep username normalization identical to Task 1’s SQL rule. Use a generic fallback for trigger failures unless duplicate username can be identified safely.

- [ ] **Step 4: Write failing repository tests**

Assert signup sends `{ data: { username }, emailRedirectTo: 'cepdepo://auth/confirm' }`; username availability is advisory; duplicate race maps safely; password reset uses `cepdepo://auth/reset-password`; resend uses signup confirmation; reset updates the active user; signout delegates once; password-reset success is identical for existing/non-existing emails.

- [ ] **Step 5: Run repository tests and verify failure**

Run: `npm test -- --runTestsByPath tests/features/auth/auth.repository.test.ts`

Expected: FAIL because `createAuthRepository` does not exist.

- [ ] **Step 6: Implement `createAuthRepository(client): AuthRepository`**

Normalize inputs before Supabase calls, pass username only as signup metadata, use the exact redirect URLs, and map every outward error through `mapAuthError`. The availability check must never be treated as a reservation; signup result remains authoritative.

- [ ] **Step 7: Run all Task 3 tests and typecheck**

Run: `npm test -- --runTestsByPath tests/features/auth/auth.validation.test.ts tests/features/auth/auth.repository.test.ts`, then `npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit auth domain behavior**

```bash
git add src/features/auth/auth.validation.ts src/features/auth/auth.errors.ts src/features/auth/auth.repository.ts tests/features/auth/auth.validation.test.ts tests/features/auth/auth.repository.test.ts
git commit -m "feat: add account authentication flows"
```

### Task 4: Account Authentication Screens and Routes

**Files:**
- Create: `src/components/ui/FormField.tsx`
- Create: `src/features/auth/SignInScreen.tsx`
- Create: `src/features/auth/SignUpScreen.tsx`
- Create: `src/features/auth/ForgotPasswordScreen.tsx`
- Create: `src/features/auth/ConfirmEmailScreen.tsx`
- Create: `src/features/auth/ResetPasswordScreen.tsx`
- Create: `app/auth/sign-in.tsx`
- Create: `app/auth/sign-up.tsx`
- Create: `app/auth/forgot-password.tsx`
- Create: `app/auth/confirm.tsx`
- Create: `app/auth/reset-password.tsx`
- Modify: `app/(tabs)/account.tsx`
- Create: `tests/components/ui/FormField.test.tsx`
- Create: `tests/features/auth/AuthScreens.test.tsx`
- Create: `tests/routes/account.test.tsx`

**Interfaces:**
- Consumes: Task 2 `useAuth`, Task 3 `AuthRepository`/validators/errors and existing `Button`, `AppText`, theme tokens.
- Produces: accessible auth routes; Account route selects signed-out auth call-to-action versus signed-in profile shell; `FormField` supports label, value, error, secure entry, keyboard/content types and accessibility metadata.

- [ ] **Step 1: Write failing shared-field and auth-screen tests**

Assert visible labels, associated accessibility hints, secure password fields, inline validation, disabled/loading submit, no double submit, signup confirmation state, identical forgot-password success copy, resend action, reset-password mismatch and successful navigation back to Account.

- [ ] **Step 2: Run UI tests and verify failure**

Run: `npm test -- --runTestsByPath tests/components/ui/FormField.test.tsx tests/features/auth/AuthScreens.test.tsx tests/routes/account.test.tsx`

Expected: FAIL because screens/routes are absent and Account is still a placeholder.

- [ ] **Step 3: Implement `FormField` and the five focused screens**

Use controlled forms with pure Task 3 validators. Each mutation owns one loading flag and ignores repeat submission. Display domain copy only; keyboard/autocorrect/capitalization settings must match each field’s purpose.

- [ ] **Step 4: Add thin auth routes and replace the Account placeholder**

Route files pass navigation callbacks only. Signed-out Account presents login/register/reset entry points; loading uses a screen state; signed-in Account delegates to the Task 5 profile screen once available, with a temporary typed shell that Task 5 replaces in the same branch.

- [ ] **Step 5: Surface unconfirmed/suspended behavior without relying on UI for enforcement**

Unconfirmed users receive resend guidance; suspended users see read-only account status. Keep all catalog tabs usable. UI state is explanatory only; Task 1 RLS remains authoritative.

- [ ] **Step 6: Run targeted tests, lint and typecheck**

Run: `npm test -- --runTestsByPath tests/components/ui/FormField.test.tsx tests/features/auth/AuthScreens.test.tsx tests/routes/account.test.tsx`, then `npm run typecheck`, then `npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit auth UI**

```bash
git add app/auth 'app/(tabs)/account.tsx' src/components/ui/FormField.tsx src/features/auth/*Screen.tsx tests/components/ui/FormField.test.tsx tests/features/auth/AuthScreens.test.tsx tests/routes/account.test.tsx
git commit -m "feat: build account authentication screens"
```

### Task 5: Profile and Avatar Management

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app.json`
- Modify: `src/lib/supabase.ts`
- Create: `src/features/profile/profile.types.ts`
- Create: `src/features/profile/profile.mapper.ts`
- Create: `src/features/profile/profile.repository.ts`
- Create: `src/features/profile/profile.queries.ts`
- Create: `src/features/profile/avatar-upload.ts`
- Create: `src/features/profile/ProfileEditor.tsx`
- Create: `src/features/profile/AccountScreen.tsx`
- Modify: `app/(tabs)/account.tsx`
- Create: `tests/features/profile/profile.repository.test.ts`
- Create: `tests/features/profile/avatar-upload.test.ts`
- Create: `tests/features/profile/AccountScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1 `profiles` and avatar policies, Task 2 `useAuth`, Task 3 username validation.
- Produces: `Profile = { userId: string; username: string; avatarPath: string | null; status: 'active' | 'suspended' }`; `AccountReview = { id: string; appSlug: string; appTitle: string; rating: number; body: string | null; updatedAt: string }`; `ProfileRepository` methods `getMine(userId: string): Promise<Profile | null>`, `updateUsername(userId: string, username: string): Promise<Profile>`, `updateAvatarPath(userId: string, avatarPath: string | null): Promise<Profile>`, `listMyReviews(userId: string): Promise<readonly AccountReview[]>`; `uploadAvatar(input: { userId: string; uri: string; mimeType: string; size: number }, deps: AvatarUploadDependencies): Promise<string>`; `getPublicAvatarUrl(path: string): string`.

- [ ] **Step 1: Install the compatible image picker**

Run: `npx expo install expo-image-picker`

Expected: compatible versions in `package.json`/lockfile and plugin/permission text added to `app.json` only if required by Expo Doctor.

- [ ] **Step 2: Write failing repository and mapper tests**

Assert own profile read, case-insensitive username collision mapping, immutable `user_id/status`, trimmed username update, own review history ordering and no email/auth metadata exposure.

- [ ] **Step 3: Run repository tests and verify failure**

Run: `npm test -- --runTestsByPath tests/features/profile/profile.repository.test.ts`

Expected: FAIL because profile modules do not exist.

- [ ] **Step 4: Implement profile domain, repository and queries**

Use exact types above. Add query keys `profileKeys.mine(userId)` and `profileKeys.reviews(userId)`; disable user queries without a user ID. Mutations invalidate only profile-dependent keys and public review displays whose usernames/avatars may change.

- [ ] **Step 5: Write failing avatar orchestration tests**

Assert MIME/extension allow-list, 5 MB rejection before upload, exact `<user-id>/avatar.<extension>` path, upload then profile update, cleanup attempt if profile update fails, previous avatar preservation, own-avatar removal and sanitized failures.

- [ ] **Step 6: Run avatar tests and verify failure**

Run: `npm test -- --runTestsByPath tests/features/profile/avatar-upload.test.ts`

Expected: FAIL because `uploadAvatar` does not exist.

- [ ] **Step 7: Implement avatar upload and public URL helper**

Accept an injected picker/fetch/storage/profile dependency bundle for tests. Convert the selected local URI to `ArrayBuffer`, use deterministic own-path upsert, update the profile only after upload, and attempt removal of the new object on profile-update failure without replacing the prior profile reference.

- [ ] **Step 8: Write and implement Account/Profile UI tests**

Test loading/error/retry, active and suspended states, username edit, picker cancellation, avatar upload/remove progress, own review history links and signout clearing only private query data. Implement `AccountScreen` and `ProfileEditor`, then replace Task 4’s signed-in shell.

- [ ] **Step 9: Run Task 5 tests and checks**

Run: `npm test -- --runTestsByPath tests/features/profile/profile.repository.test.ts tests/features/profile/avatar-upload.test.ts tests/features/profile/AccountScreen.test.tsx tests/routes/account.test.tsx`, then `npm run typecheck`, then `npm run lint`, then `npx expo-doctor`

Expected: PASS with no dependency mismatch.

- [ ] **Step 10: Commit profile management**

```bash
git add package.json package-lock.json app.json 'app/(tabs)/account.tsx' src/lib/supabase.ts src/features/profile tests/features/profile tests/routes/account.test.tsx
git commit -m "feat: add profile and avatar management"
```

### Task 6: Review Data Layer and Query Invalidation

**Files:**
- Create: `src/features/reviews/review.types.ts`
- Create: `src/features/reviews/review.mapper.ts`
- Create: `src/features/reviews/review.repository.ts`
- Create: `src/features/reviews/review.queries.ts`
- Create: `tests/features/reviews/review.mapper.test.ts`
- Create: `tests/features/reviews/review.repository.test.ts`
- Create: `tests/features/reviews/review.queries.test.tsx`

**Interfaces:**
- Consumes: Task 1 `reviews`, `profiles`, `review_rating_summaries`; Task 2 user ID; catalog app IDs.
- Produces: `RatingSummary = { average: number | null; count: number }`; `Review = { id: string; appId: string; userId: string; username: string; avatarPath: string | null; rating: number; body: string | null; createdAt: string; updatedAt: string }`; `ReviewDraft = { rating: 1 | 2 | 3 | 4 | 5; body: string }`; repository methods `getSummary(appId: string): Promise<RatingSummary>`, `listVisible(appId: string): Promise<readonly Review[]>`, `getMine(appId: string, userId: string): Promise<Review | null>`, `saveMine(appId: string, userId: string, draft: ReviewDraft): Promise<Review>`, `deleteMine(appId: string, userId: string): Promise<void>`; `reviewKeys` and mutation hooks.

- [ ] **Step 1: Write failing mapper/repository tests**

Assert nullable zero-review average, deterministic date order, profile projection, optional blank body normalized to `null`, upsert limited by current user/app, rating bounds, delete ownership, hidden review exclusion and safe errors.

- [ ] **Step 2: Run mapper/repository tests and verify failure**

Run: `npm test -- --runTestsByPath tests/features/reviews/review.mapper.test.ts tests/features/reviews/review.repository.test.ts`

Expected: FAIL because review modules do not exist.

- [ ] **Step 3: Implement review types, mappers and repository**

Use generated database types and exact interfaces above. Never accept `userId` or moderation status from `ReviewDraft`; query hooks obtain `userId` only from Task 2’s session, and RLS verifies it. Write only `app_id`, `user_id`, `rating` and normalized `body` on insert; update only rating/body through column-scoped grants.

- [ ] **Step 4: Write failing query/invalidation tests**

Assert keys are scoped by app/user; queries disable without required IDs; save/delete invalidates summary, visible list, current user’s review and account review history; anonymous `catalogKeys` are not removed or globally cleared.

- [ ] **Step 5: Run query tests and verify failure**

Run: `npm test -- --runTestsByPath tests/features/reviews/review.queries.test.tsx`

Expected: FAIL because review query hooks do not exist.

- [ ] **Step 6: Implement review query keys and hooks**

Expose hooks for summary, visible list, mine, save and delete. Use targeted `invalidateQueries` calls and prevent concurrent mutation submission through mutation pending state.

- [ ] **Step 7: Run Task 6 tests and typecheck**

Run: `npm test -- --runTestsByPath tests/features/reviews`, then `npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit review data behavior**

```bash
git add src/features/reviews/review.types.ts src/features/reviews/review.mapper.ts src/features/reviews/review.repository.ts src/features/reviews/review.queries.ts tests/features/reviews
git commit -m "feat: add ratings and reviews data layer"
```

### Task 7: Ratings and Reviews User Interface

**Files:**
- Create: `src/features/reviews/RatingSummary.tsx`
- Create: `src/features/reviews/StarRatingInput.tsx`
- Create: `src/features/reviews/ReviewForm.tsx`
- Create: `src/features/reviews/ReviewList.tsx`
- Create: `src/features/reviews/ReviewsSection.tsx`
- Modify: `src/features/catalog/AppDetailScreen.tsx`
- Create: `tests/features/reviews/RatingSummary.test.tsx`
- Create: `tests/features/reviews/ReviewForm.test.tsx`
- Create: `tests/features/reviews/ReviewsSection.test.tsx`
- Modify: `tests/features/catalog/AppDetailScreen.test.tsx`
- Modify: `tests/features/profile/AccountScreen.test.tsx`

**Interfaces:**
- Consumes: Task 2 `useAuth`, Task 5 profile status/history, Task 6 review hooks and existing catalog detail.
- Produces: `ReviewsSection({ appId, appSlug }: { appId: string; appSlug: string })`; accessible five-star input; public summary/list and authenticated own-review editor.

- [ ] **Step 1: Write failing rating and form tests**

Assert `Henüz puan yok` for count zero, one-decimal average otherwise, accessible 1–5 radio-like controls, rating-only submit, trimmed 3–2000 body validation, edit prefill, delete confirmation, pending-state double-submit prevention and Turkish safe errors.

- [ ] **Step 2: Run rating/form tests and verify failure**

Run: `npm test -- --runTestsByPath tests/features/reviews/RatingSummary.test.tsx tests/features/reviews/ReviewForm.test.tsx`

Expected: FAIL because UI components do not exist.

- [ ] **Step 3: Implement rating summary, stars and form**

Use text/accessibility state in addition to color. Keep star targets at least 44×44. Save body as empty input for repository normalization; do not inject/render HTML.

- [ ] **Step 4: Write failing section/detail tests**

Assert loading/empty/error/retry/public list, anonymous login CTA, unconfirmed verification CTA, suspended read-only notice, own review editor, account-history refresh and placement after version history without breaking download behavior.

- [ ] **Step 5: Run section/detail tests and verify failure**

Run: `npm test -- --runTestsByPath tests/features/reviews/ReviewsSection.test.tsx tests/features/catalog/AppDetailScreen.test.tsx tests/features/profile/AccountScreen.test.tsx`

Expected: FAIL until `ReviewsSection` is integrated.

- [ ] **Step 6: Implement list/section and integrate app detail/account history**

Render current username/avatar at read time, preserve catalog detail loading/error behavior, and route login CTA to `/auth/sign-in`. Account history links use the existing `/apps/[slug]` detail route.

- [ ] **Step 7: Run review UI and catalog regressions**

Run: `npm test -- --runTestsByPath tests/features/reviews tests/features/catalog/AppDetailScreen.test.tsx tests/features/profile/AccountScreen.test.tsx`

Expected: PASS, including prior download tests.

- [ ] **Step 8: Commit community review UI**

```bash
git add src/features/reviews src/features/catalog/AppDetailScreen.tsx tests/features/reviews tests/features/catalog/AppDetailScreen.test.tsx tests/features/profile/AccountScreen.test.tsx
git commit -m "feat: add ratings and reviews interface"
```

### Task 8: Application and Version Reports

**Files:**
- Create: `src/features/reports/report.types.ts`
- Create: `src/features/reports/report.validation.ts`
- Create: `src/features/reports/report.repository.ts`
- Create: `src/features/reports/report.queries.ts`
- Create: `src/features/reports/ReportSheet.tsx`
- Modify: `src/features/catalog/AppDetailScreen.tsx`
- Modify: `src/features/catalog/VersionHistory.tsx`
- Create: `tests/features/reports/report.validation.test.ts`
- Create: `tests/features/reports/report.repository.test.ts`
- Create: `tests/features/reports/ReportSheet.test.tsx`
- Modify: `tests/features/catalog/AppDetailScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1 `reports`, Task 2 auth state, catalog app/version IDs.
- Produces: `ReportTarget = { appId: string; appTitle: string; versionId: string | null; versionName: string | null }`; `ReportDraft = { reason: ReportReason; description: string }`; repository methods `getOpen(target: ReportTarget, reporterId: string): Promise<Report | null>` and `submitReport(target: ReportTarget, reporterId: string, draft: ReportDraft): Promise<Report>`; `useOpenReport(target: ReportTarget)` obtains the reporter from auth context; reusable `ReportSheet`.

- [ ] **Step 1: Write failing report validation/repository tests**

Assert exact reason values and Turkish labels, optional blank description to `null`, 3–1000 trimmed body rule, immutable reporter/status/admin fields, matching app/version insertion, app-only target insertion, duplicate-open mapping and sanitized failures.

- [ ] **Step 2: Run domain tests and verify failure**

Run: `npm test -- --runTestsByPath tests/features/reports/report.validation.test.ts tests/features/reports/report.repository.test.ts`

Expected: FAIL because report modules do not exist.

- [ ] **Step 3: Implement report domain, repository and queries**

Identity comes from auth/RLS, never form input. Query only the current user’s open report for the exact nullable target. On success invalidate that target only and expose `alreadyOpen` for UI.

- [ ] **Step 4: Write failing report sheet/integration tests**

Assert target title/version is visible, reason required, description validation, login and verification gates, suspended read-only state, pending-state double-submit prevention, success confirmation, already-open disabled state, app report action and per-version report action.

- [ ] **Step 5: Run UI tests and verify failure**

Run: `npm test -- --runTestsByPath tests/features/reports/ReportSheet.test.tsx tests/features/catalog/AppDetailScreen.test.tsx`

Expected: FAIL until report actions are integrated.

- [ ] **Step 6: Implement `ReportSheet` and integrate both targets**

Use a React Native modal/sheet with focusable controls and dismiss action. Add one app-level action in detail and one action per version; do not allow arbitrary IDs from route params to bypass the loaded catalog entity.

- [ ] **Step 7: Run Task 8 tests and checks**

Run: `npm test -- --runTestsByPath tests/features/reports tests/features/catalog/AppDetailScreen.test.tsx`, then `npm run typecheck`, then `npm run lint`

Expected: PASS.

- [ ] **Step 8: Commit reporting flow**

```bash
git add src/features/reports src/features/catalog/AppDetailScreen.tsx src/features/catalog/VersionHistory.tsx tests/features/reports tests/features/catalog/AppDetailScreen.test.tsx
git commit -m "feat: add app and version reporting"
```

### Task 9: Full Regression, Documentation and Hosted Deployment Runbook

**Files:**
- Modify: `README.md`
- Modify: `.env.example` only if a new public value is truly required
- Modify: tests discovered by the full suite only when behavior intentionally changed

**Interfaces:**
- Consumes: Tasks 1–8 completed application.
- Produces: documented local/hosted auth setup, redirect/SMTP checklist, community behavior and release prerequisites; a green release candidate.

- [ ] **Step 1: Run the complete verification suite**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run db:reset`, `npm run db:test`, `npx supabase db advisors --local`, `npx expo-doctor`

Expected: every command passes; fix root causes in the owning module and add a regression test before continuing.

- [ ] **Step 2: Verify generated database types are current**

Run: `cp src/types/database.types.ts /tmp/opencode/cep-depo-database.types.ts`, `npm run db:types`, then `diff -u /tmp/opencode/cep-depo-database.types.ts src/types/database.types.ts`

Expected: no diff.

- [ ] **Step 3: Update README setup and behavior documentation**

Document account/community scope, local Mailpit verification, hosted Auth redirect URLs, production SMTP requirement, avatar constraints, RLS ownership guarantees, no-secret rule, database commands and the fact that app publishing/admin/follows/notifications remain later deliveries.

- [ ] **Step 4: Add a hosted deployment checklist without credentials**

Document `npx supabase link --project-ref PROJECT_REF`, migration review/push, redirect allow-list, email confirmation, SMTP and production public EAS variables. Require the operator to verify the linked project ref before `db push`; do not automate against an unknown project.

- [ ] **Step 5: Re-run docs-adjacent checks and inspect final diff**

Run: `npm run typecheck`, `npm run lint`, `git diff --check`, `git status --short`

Expected: checks pass; status contains only intentional Task 9 files.

- [ ] **Step 6: Commit release documentation and regression fixes**

```bash
git add README.md .env.example src tests supabase
git commit -m "docs: prepare accounts community deployment"
```

### Task 10: Production Migration and Shareable APK Release

**Files:**
- Modify: `app.json`
- Modify: `README.md` with released version/link only if the project’s documentation policy keeps release links there
- Do not commit: credentials, `.env`, signing material or downloaded APK binaries unless the user explicitly chooses repository-hosted artifacts

**Interfaces:**
- Consumes: green Task 9 release candidate; user-provided hosted Supabase project access and EAS authentication.
- Produces: hosted schema/auth configuration, incremented app version, signed installable APK and shareable EAS HTTPS URL.

- [ ] **Step 1: Confirm external-release prerequisites with the user**

Require: correct hosted Supabase project ref, publishable key, configured production SMTP, allowed auth redirects, authenticated EAS account and confirmation that the existing Android signing credential is the permanent key. Stop rather than substituting placeholders or creating a different signing identity silently.

- [ ] **Step 2: Inspect and apply hosted migrations safely**

Run: `npx supabase link --project-ref PROJECT_REF`, `npx supabase migration list`, then `npx supabase db push --dry-run` if supported by the installed CLI (discover with `npx supabase db push --help`). Review output before running `npx supabase db push`.

Expected: only reviewed local migrations apply to the intended project.

- [ ] **Step 3: Verify hosted Auth and public environment**

Confirm email confirmation, `cepdepo://auth/confirm`, `cepdepo://auth/reset-password`, SMTP and EAS `production` values for `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, privacy, terms and contact URLs. Confirm no service-role/secret variable exists in Expo environment.

- [ ] **Step 4: Perform a real hosted smoke test before release build**

On a development build/device: register, receive confirmation email, deep-link confirm, sign in/out, request/reset password, edit profile/avatar, submit rating-only review, edit/delete review, submit app report, submit version report, verify duplicate report is blocked, then sign out and download an APK anonymously.

Expected: all acceptance flows work against hosted Supabase.

- [ ] **Step 5: Increment release identity**

Update `app.json` from `version: 0.1.0` and `android.versionCode: 1` to the next approved release values. Never decrease or reuse a published `versionCode`.

- [ ] **Step 6: Run final local release gate**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run db:test`, `npx expo-doctor`, `npx expo export --platform android`

Expected: all commands pass and Android export completes.

- [ ] **Step 7: Commit version bump**

```bash
git add app.json README.md
git commit -m "chore: prepare accounts community release"
```

- [ ] **Step 8: Build the signed production APK**

Run: `npx eas-cli build --platform android --profile release`

Expected: successful signed APK build using `com.cepdepo.app` and the preserved signing credential; capture the EAS build URL and artifact URL.

- [ ] **Step 9: Install and smoke-test the exact release artifact**

Download the EAS artifact to a test device, verify package/version, repeat signup/login/community and anonymous download critical paths, and confirm deep links open the installed release build.

- [ ] **Step 10: Deliver the shareable link and release facts**

Report version, `versionCode`, commit SHA, EAS build URL, APK artifact URL, build timestamp, tested device/Android version and known limitation that Android requires user approval for unknown-source installation. Do not claim installation success on untested devices.
