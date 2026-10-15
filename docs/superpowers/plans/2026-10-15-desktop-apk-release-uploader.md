# Desktop APK Release Uploader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-click Linux desktop tool that publishes a locally verified APK to a dedicated public GitHub Release and copies its verified direct HTTPS URL.

**Architecture:** A sourceable Bash library owns pure validation and GitHub transaction boundaries; a thin Zenity script owns operator interaction; an idempotent installer owns the user-level desktop launcher. GitHub credentials remain in the existing `gh` keyring session, releases remain drafts until remote integrity checks pass, and the tool never calls Cep Depo catalog APIs.

**Tech Stack:** Bash 5.2, Zenity, GitHub CLI, GitHub Releases API, `sha256sum`, `unzip`, `curl`, `xclip`, freedesktop `.desktop` launcher

**Spec:** `docs/superpowers/specs/2026-10-15-desktop-apk-release-uploader-design.md`

## Global Constraints

- Target only the fixed public repository `SamulVanunu/cep-depo-apks`.
- Require active GitHub CLI account `SamulVanunu`; never read, print, or persist its token.
- Accept only release names matching `^[A-Za-z0-9._-]+$`; never replace an existing tag or asset.
- Accept readable, non-empty `.apk` files smaller than 2 GiB with ZIP magic `504b0304` and passing `unzip -tq`.
- Publish a draft only after remote state, byte size, SHA-256 digest, content type, and direct public HTTPS URL match.
- Leave a post-creation failure as a private draft; never silently delete remote state.
- Never create or publish a Cep Depo catalog version and never alter `EXTERNAL_APK_PUBLISHING_ENABLED`.
- Add no package dependency, secret, environment file, APK, or generated launcher to Git.

## Review Focus

- A valid APK path containing spaces or non-ASCII characters must upload as one quoted argument; pin this in Task 3's orchestration test.
- An existing public release or private draft with the requested tag must stop before create/upload; pin this in Task 2's collision test.
- A missing or malformed GitHub digest must keep the release draft and must not call publish; pin this in Task 2's metadata matrix.
- Clipboard failure after successful publication must show the recoverable direct URL instead of claiming the upload failed; pin this in Task 3's post-publish test.
- Cancellation or upload failure after draft creation must preserve the draft and report its repository/tag for recovery; pin this in Task 3's failure test.

---

### Task 1: Local APK and Release Input Validation

**Files:**
- Create: `scripts/apk-release-uploader/lib.sh`
- Create: `scripts/apk-release-uploader/tests/run.sh`
- Reuse fixture: `admin/e2e/fixtures/test.apk`

**Interfaces:**
- Produces: `validate_release_tag(tag)`, `validate_apk_file(path)`, `apk_size(path)`, `apk_sha256(path)`, and `set_error(message)`.
- Contract: validation functions return `0` on success; on failure they return non-zero and set global `UPLOAD_ERROR` to operator-safe Turkish text.

- [ ] **Step 1: Write failing validation tests**

In `tests/run.sh`, source `lib.sh` and add named cases asserting:

- `hikari-v9` is accepted;
- blank, slash, whitespace, and shell-metacharacter tags are rejected;
- `admin/e2e/fixtures/test.apk` is accepted;
- missing, empty, `.zip`, wrong-magic, corrupt-ZIP, and exactly 2 GiB files are rejected;
- an APK path under a temporary directory containing spaces and `İ` is accepted;
- valid fixture size and SHA-256 equal the shell utilities' results.

- [ ] **Step 2: Run tests and verify RED**

Run: `bash scripts/apk-release-uploader/tests/run.sh validation`

Expected: FAIL because `lib.sh` functions do not exist.

- [ ] **Step 3: Implement the validation interfaces**

Use quoted Bash arguments, `stat -c %s`, `od -An -tx1 -N4`, `unzip -tq`, and `sha256sum`. Define `GITHUB_ASSET_MAX_BYTES=2147483648`; reject `size >= GITHUB_ASSET_MAX_BYTES`.

- [ ] **Step 4: Run validation tests and syntax checks**

Run:

```bash
bash scripts/apk-release-uploader/tests/run.sh validation
bash -n scripts/apk-release-uploader/lib.sh scripts/apk-release-uploader/tests/run.sh
```

Expected: all validation cases PASS; syntax checks exit `0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/apk-release-uploader/lib.sh scripts/apk-release-uploader/tests/run.sh
git commit -m "feat: validate desktop APK uploads"
```

### Task 2: Draft-First GitHub Release Transaction

**Files:**
- Modify: `scripts/apk-release-uploader/lib.sh`
- Modify: `scripts/apk-release-uploader/tests/run.sh`

**Interfaces:**
- Consumes: Task 1 validation and digest interfaces.
- Produces: `require_commands()`, `require_github_account()`, `release_exists(tag)`, `create_draft_release(tag, sha256)`, `upload_release_asset(tag, apk_path)`, `read_remote_asset(tag, filename)`, `validate_remote_asset(local_size, local_sha256, remote_record)`, `publish_release(tag)`, and `probe_direct_url(url)`.
- `read_remote_asset` emits one tab-separated record: `state`, `size`, `digest`, `content_type`, `browser_download_url`.
- External commands are replaceable in tests through `GH_BIN`, `CURL_BIN`, `UNZIP_BIN`, `SHA256_BIN`, `XCLIP_BIN`, and `ZENITY_BIN`, each defaulting to the corresponding command name.

- [ ] **Step 1: Write failing GitHub transaction tests**

Extend `tests/run.sh` with mocked `gh`/`curl` binaries and assert:

- required-command and wrong-account checks fail closed;
- an existing public release or draft stops before create/upload;
- draft creation precedes upload and publication;
- the upload command receives a spaced/non-ASCII APK path as one argument;
- matching `uploaded`, size, `sha256:<digest>`, accepted content type, and fixed-repository HTTPS URL permit publication;
- mismatched/missing digest, size, state, content type, credentials/query/fragment, or wrong host/path reject publication;
- `probe_direct_url` accepts only a successful redirect-following HTTPS response.

- [ ] **Step 2: Run transaction tests and verify RED**

Run: `bash scripts/apk-release-uploader/tests/run.sh github`

Expected: FAIL because GitHub transaction functions do not exist.

- [ ] **Step 3: Implement command and account guards**

`require_commands` checks `zenity gh sha256sum unzip curl xclip`; `require_github_account` compares `gh api user --jq .login` case-insensitively with `SamulVanunu` and returns an operator-safe error otherwise.

- [ ] **Step 4: Implement draft creation, upload, metadata reading, and publication**

Use fixed constants `GITHUB_REPOSITORY=SamulVanunu/cep-depo-apks` and `GITHUB_OWNER=SamulVanunu`. Create with `gh release create --draft`; query release assets through `gh api repos/$GITHUB_REPOSITORY/releases/tags/$tag --jq`; publish with `gh release edit "$tag" --draft=false` only after `validate_remote_asset` passes.

- [ ] **Step 5: Implement direct URL probing**

Require the exact prefix `https://github.com/SamulVanunu/cep-depo-apks/releases/download/`, reject `?`, `#`, and credentials, then use `curl --fail --silent --show-error --location --head --max-time 30`.

- [ ] **Step 6: Run transaction tests and syntax checks**

Run:

```bash
bash scripts/apk-release-uploader/tests/run.sh github
bash -n scripts/apk-release-uploader/lib.sh scripts/apk-release-uploader/tests/run.sh
```

Expected: all transaction cases PASS; syntax checks exit `0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/apk-release-uploader/lib.sh scripts/apk-release-uploader/tests/run.sh
git commit -m "feat: publish verified GitHub APK releases"
```

### Task 3: Zenity Workflow and Desktop Launcher

**Files:**
- Create: `scripts/apk-release-uploader/upload.sh`
- Create: `scripts/apk-release-uploader/install.sh`
- Create: `scripts/apk-release-uploader/cep-depo-apk-uploader.desktop.template`
- Modify: `scripts/apk-release-uploader/tests/run.sh`

**Interfaces:**
- Consumes: Task 1 and Task 2 library functions.
- Produces: interactive `upload.sh`, idempotent `install.sh`, and user launcher `~/.local/share/applications/cep-depo-apk-uploader.desktop`.
- Test mode: `APK_UPLOADER_MODE=noninteractive`, `APK_UPLOADER_APK_PATH`, and `APK_UPLOADER_RELEASE_TAG` replace Zenity input while preserving the same transaction.

- [ ] **Step 1: Write failing workflow tests**

Add cases asserting:

- chooser cancellation exits `0` without GitHub calls;
- invalid file/tag returns before draft creation and surfaces `UPLOAD_ERROR`;
- valid input runs guard → draft → upload → metadata validation → publish → probe in order;
- post-draft upload/metadata failure never invokes publish and reports the preserved draft tag;
- a spaced/non-ASCII path survives end-to-end mocks;
- successful publication writes only the verified URL to `xclip`;
- `xclip` failure keeps exit success after publication and displays the URL for manual copying.

- [ ] **Step 2: Write failing installer tests**

With temporary `HOME`, assert `install.sh` creates one launcher with `Terminal=false`, the absolute `upload.sh` path, no token, mode `0644`, and identical content on a second run.

- [ ] **Step 3: Run workflow tests and verify RED**

Run: `bash scripts/apk-release-uploader/tests/run.sh workflow`

Expected: FAIL because uploader, installer, and launcher template do not exist.

- [ ] **Step 4: Implement `upload.sh`**

Source `lib.sh`, avoid `set -x`, use a trap only for local temporary files, and keep the GitHub draft on post-creation failure. Use a Zenity progress dialog without echoing command output; the final success dialog includes repository/tag, size, SHA-256, direct URL, and the reminder to select the same APK in the admin panel.

- [ ] **Step 5: Implement launcher template and installer**

Use desktop name `Cep Depo APK Yükleyici`, generic icon `system-software-install`, `Type=Application`, `Categories=Utility;`, and `Terminal=false`. Expand only `@UPLOADER_PATH@`; create directories with user permissions and optionally refresh `update-desktop-database` when present.

- [ ] **Step 6: Run workflow tests and syntax checks**

Run:

```bash
bash scripts/apk-release-uploader/tests/run.sh workflow
bash scripts/apk-release-uploader/tests/run.sh all
bash -n scripts/apk-release-uploader/*.sh scripts/apk-release-uploader/tests/run.sh
```

Expected: every test PASS; syntax checks exit `0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/apk-release-uploader
git commit -m "feat: add one-click APK release uploader"
```

### Task 4: Dedicated Repository, Documentation, and Release Gate

**Files:**
- Create: `docs/apk-release-uploader.md`
- Modify: `.memory/CURRENT.md` (do not commit without explicit approval)

**Interfaces:**
- Consumes: complete uploader and installer from Tasks 1–3.
- Produces: public repository `SamulVanunu/cep-depo-apks`, installed launcher, operator documentation, and integration evidence.

- [ ] **Step 1: Create the dedicated public repository**

Run:

```bash
gh repo create SamulVanunu/cep-depo-apks \
  --public \
  --add-readme \
  --description "Public APK releases distributed through Cep Depo"
```

Expected: repository URL `https://github.com/SamulVanunu/cep-depo-apks`; fail rather than repurpose a different existing repository.

- [ ] **Step 2: Write operator documentation**

Document prerequisites, launcher installation, upload flow, direct URL use in the admin panel, draft recovery, collision handling, and the separation between GitHub upload, catalog draft, final publication, and rollout enablement.

- [ ] **Step 3: Run the local release gate**

Run:

```bash
bash scripts/apk-release-uploader/tests/run.sh all
bash -n scripts/apk-release-uploader/*.sh scripts/apk-release-uploader/tests/run.sh
if command -v shellcheck >/dev/null; then
  shellcheck scripts/apk-release-uploader/*.sh scripts/apk-release-uploader/tests/run.sh
else
  echo "shellcheck not installed; skipped"
fi
git diff --check
```

Expected: tests and syntax checks pass; ShellCheck is clean when installed; no whitespace errors.

- [ ] **Step 4: Install and inspect the launcher**

Run:

```bash
bash scripts/apk-release-uploader/install.sh
grep -F "Exec=" "$HOME/.local/share/applications/cep-depo-apk-uploader.desktop"
grep -F "Terminal=false" "$HOME/.local/share/applications/cep-depo-apk-uploader.desktop"
```

Expected: launcher points to this worktree's `upload.sh`, contains no credential, and appears in the application menu.

- [ ] **Step 5: Stop for explicit integration-test approval**

Ask before creating a public smoke-test release in `SamulVanunu/cep-depo-apks`. Approval covers only uploading `admin/e2e/fixtures/test.apk` under a unique `uploader-smoke-<UTC timestamp>` tag; deletion remains a separate destructive action.

- [ ] **Step 6: Run and verify the approved integration test**

Run `upload.sh` in non-interactive mode with the fixture and unique tag. Verify through `gh api` that state, size, digest, content type, and direct URL match; use `curl --location` to download and compare SHA-256. Do not create a catalog draft.

- [ ] **Step 7: Commit documentation**

```bash
git add docs/apk-release-uploader.md
git commit -m "docs: document APK release uploader"
```

- [ ] **Step 8: Update uncommitted handoff memory**

Record commit IDs, repository URL, launcher path, exact verification commands/results, smoke tag/URL, and remaining catalog rollout gate in `.memory/CURRENT.md`. Confirm it is the only intentional uncommitted file.
