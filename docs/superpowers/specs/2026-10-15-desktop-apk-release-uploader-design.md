# Desktop APK Release Uploader Design

## Objective

Provide a one-click Linux desktop tool that uploads large APK files to a dedicated public GitHub Releases repository and returns a verified direct HTTPS asset URL for the Cep Depo admin publishing flow.

The tool exists to make external APK hosting understandable and repeatable without placing a GitHub credential in the browser, Vercel, the mobile application, or the public catalog.

## User Outcome

The operator launches **Cep Depo APK Yükleyici** from the desktop application menu, selects an APK, enters a short release name such as `hikari-v9`, and waits for one success dialog. The dialog shows the verified direct APK URL and copies it to the clipboard. The operator then selects the same local APK in the admin panel and pastes the copied URL.

Success means:

- the uploaded asset is public and directly downloadable over HTTPS;
- the remote byte size and SHA-256 digest match the selected local file;
- incomplete or mismatched uploads are never published;
- no GitHub token is stored in project files or sent to Vercel;
- the tool never creates or publishes a Cep Depo catalog version.

## Scope

### Included

- A dedicated public repository: `SamulVanunu/cep-depo-apks`.
- A repository-owned Bash script using Zenity for desktop prompts.
- A `.desktop` launcher installer for the current Linux user.
- Local APK validation before upload.
- Draft GitHub Release creation, asset upload, remote integrity verification, publication, and direct URL copying.
- Actionable failure dialogs and terminal diagnostics that do not expose credentials.
- Automated tests for deterministic validation and command orchestration.
- One explicitly approved end-to-end test with the existing non-installable fixture.

### Excluded

- Uploading from the web admin panel.
- Storing GitHub credentials in Vercel, Supabase, source files, or generated configuration.
- Automatically creating, publishing, archiving, or activating catalog versions.
- Automatically enabling `EXTERNAL_APK_PUBLISHING_ENABLED`.
- Parsing Android package metadata or guessing the app version from the APK.
- Replacing an existing release or asset.
- Deleting the existing `cep-depo-apk-test` repository.

## Architecture

### Components

1. `scripts/apk-release-uploader.sh`
   - Owns validation and GitHub release orchestration.
   - Uses existing system commands: `zenity`, `gh`, `sha256sum`, `unzip`, `curl`, and `xclip`.
   - Supports an interactive desktop mode and a non-interactive test mode with dependency paths injected through environment variables.

2. `scripts/install-apk-release-uploader.sh`
   - Installs a launcher under `~/.local/share/applications/` for the current user.
   - Uses an absolute path to the repository-owned uploader script.
   - Is idempotent and does not require root access.

3. `scripts/desktop/cep-depo-apk-uploader.desktop.template`
   - Defines the application name, icon category, terminal behavior, and launcher command.
   - The installer expands only the script path; it does not embed secrets.

4. `scripts/tests/apk-release-uploader.test.sh`
   - Runs uploader functions against temporary fixture directories and mocked external commands.
   - Never contacts GitHub during normal test runs.

### External Services

- GitHub repository: `SamulVanunu/cep-depo-apks`.
- Authentication: the existing GitHub CLI keyring session for `SamulVanunu`.
- Public artifact delivery: GitHub Releases `browser_download_url`.

## Upload Flow

1. Verify required commands and the active GitHub CLI account.
2. Open a Zenity APK file chooser.
3. Ask for one release name, for example `hikari-v9`.
4. Normalize surrounding whitespace and accept only `A-Za-z0-9._-` characters.
5. Refuse an empty name or an existing release tag. The tool never overwrites or deletes a prior release.
6. Validate the local file:
   - regular readable file;
   - `.apk` extension;
   - non-empty and below GitHub's 2 GiB release-asset limit;
   - ZIP magic `50 4b 03 04`;
   - complete ZIP integrity through `unzip -tq`.
7. Calculate local byte size and lowercase SHA-256.
8. Create a draft GitHub Release with the local SHA-256 in its notes.
9. Upload the APK asset using its original filename.
10. Query the GitHub Releases API for the uploaded asset and verify:
    - state is `uploaded`;
    - byte size equals the local size;
    - digest equals `sha256:<local digest>`;
    - content type is an accepted APK/binary media type;
    - the direct asset URL is public HTTPS and has no query or fragment.
11. Publish the draft release only after every verification succeeds.
12. Perform a lightweight direct URL request that must resolve successfully to the APK asset.
13. Copy the direct URL with `xclip` and show the URL, size, and SHA-256 in a success dialog.

The selected local APK remains unchanged throughout the process.

## Transaction and Failure Handling

The public visibility boundary is the final draft publication step.

- Failures before draft creation leave no GitHub release.
- Failures after draft creation leave the release as a private draft for diagnosis; the tool does not silently delete remote state.
- A retry with the same tag is refused and tells the operator to inspect or remove the existing draft manually. This prevents accidental replacement.
- Closing a Zenity chooser is a clean cancellation, not an error.
- Network, authentication, validation, and remote-integrity failures use distinct operator messages.
- Raw tokens, authorization headers, and complete environment dumps are never logged.
- Successful output contains only the repository, tag, asset name, byte size, SHA-256, and direct public URL.

## Security Model

- The tool relies on `gh auth` and the OS keyring; it never reads or writes the token itself.
- The dedicated repository is public because catalog APK URLs are public by design.
- Release names and filenames are passed as quoted command arguments and are never evaluated as shell code.
- The fixed repository owner/name is not taken from untrusted form input.
- Existing releases are immutable from the tool's perspective.
- The generated direct URL is validated by the same public-HTTPS constraints used by the admin flow: no credentials, query, fragment, localhost, private IP, single-label hostname, or private/special-use suffix.
- Publishing an asset to GitHub does not authorize catalog publication. Admin authentication, draft creation, final publication, and the external rollout flag remain separate controls.

## User Interface

The desktop interaction has at most three dialogs:

1. APK file chooser.
2. Release-name entry with an example and validation feedback.
3. Progress followed by success or an actionable error.

The success dialog states that the URL has been copied and reminds the operator to select the same APK in the admin panel. It does not claim that the app is published in Cep Depo.

## Configuration

The initial version fixes the target repository to:

```text
SamulVanunu/cep-depo-apks
```

This avoids prompting for or accidentally publishing to an arbitrary repository. Changing the repository later is a reviewed source/config change.

No secrets or environment files are added. The launcher depends on the already authenticated GitHub CLI account and fails closed if the active account is not `SamulVanunu`.

## Testing

### Automated

- Accept valid APK ZIP magic and ZIP structure.
- Reject missing, empty, unreadable, wrong-extension, oversized, and malformed files.
- Accept safe release names and reject whitespace-only, shell metacharacter, slash, and existing-tag cases.
- Verify that release creation is draft-first.
- Refuse publication when remote state, size, digest, content type, or URL differs.
- Publish only after every integrity check passes.
- Quote filenames containing spaces correctly.
- Copy and display only the verified URL.
- Preserve a draft on post-creation failure.
- Treat dialog cancellation as a clean exit.

### Integration

- Run ShellCheck when available.
- Install and launch the `.desktop` entry for the current user.
- With separate approval, upload the existing 21-byte non-installable fixture under a unique test tag, verify the direct URL, then leave cleanup as a separate explicit operation.
- Never use a fake fixture for catalog publication or Android installation testing.

## Rollout and Operations

1. Create the dedicated public GitHub repository with an explanatory README.
2. Implement and verify the uploader and installer locally.
3. Install the launcher for the current Linux user.
4. Perform the separately approved fixture integration test.
5. Use the tool for a real APK only after the fixture flow succeeds.

The existing `cep-depo-apk-test` repository and its releases remain untouched unless deletion is separately approved.

## Rollback

- Disable the local tool by removing its user-level `.desktop` entry; the repository scripts remain available for review.
- Existing public releases remain downloadable and are not deleted automatically.
- Reverting the tool code does not affect Supabase, Vercel, mobile clients, or catalog records.
- Deleting a public release or repository is destructive and always requires separate explicit approval.
