# APK Release Uploader

This Linux desktop tool uploads an APK to the public
[`SamulVanunu/cep-depo-apks`](https://github.com/SamulVanunu/cep-depo-apks)
GitHub Releases repository and returns a verified direct HTTPS URL. It does not
create or publish a Cep Depo catalog version.

## Prerequisites

- Linux desktop environment with `zenity` and a per-user application menu.
- `gh`, `sha256sum`, `unzip`, `curl`, and `xclip` available on `PATH`.
- GitHub CLI authenticated as `SamulVanunu` (`gh auth login`). The credential
  stays in the GitHub CLI/OS keyring and is not stored in the launcher.
- A structurally valid `.apk` smaller than 2 GiB.

Check the active account before operating the uploader:

```bash
gh auth status
gh api user --jq .login
```

## Install the launcher

From the repository root, run:

```bash
bash scripts/apk-release-uploader/install.sh
```

This installs
`~/.local/share/applications/cep-depo-apk-uploader.desktop` for the current
user. The launcher points to this checkout's `upload.sh`, so keep the checkout
at the same path. Re-running the installer safely refreshes the launcher.

Open **Cep Depo APK Yükleyici** from the application menu. To disable the menu
entry without changing repository files, remove the installed `.desktop` file.

## Upload an APK

1. Launch **Cep Depo APK Yükleyici**.
2. Select the local APK.
3. Enter a unique release tag such as `hikari-v9`. Tags may contain only ASCII
   letters, digits, dots, underscores, and hyphens.
4. Wait for the success dialog. The uploader validates the local archive,
   creates a draft GitHub Release, uploads the asset, verifies its state, size,
   SHA-256 digest, content type, and URL, and only then publishes the release.
5. Copy the verified direct URL from the dialog. The uploader also attempts to
   place it on the clipboard.

The target repository is fixed in source. The uploader never overwrites or
deletes an existing release and never modifies the selected local APK.

## Use the URL in the admin panel

GitHub upload and Cep Depo publication are separate operations:

1. In the Cep Depo admin panel, select the existing application or complete all required fields for a new application, including its initial icon.
2. Select the same local APK so the admin flow can validate its metadata.
3. Choose the external HTTPS source and paste the exact GitHub Releases
   `browser_download_url` shown by the uploader.
4. Submit **APK'yı yükle ve yayınla**. The admin reads package name, version name,
   and version code from the manifest and automatically publishes only after all
   validation succeeds; there is no user-visible draft or separate publish step.
5. Treat rollout enablement as another independent gate. Uploading the GitHub
   asset and publishing a catalog version do not enable the external APK
   rollout flag or deploy configuration changes.

For an update, the manifest package must match the application's established
package and its real version code must be higher than the current release. The
new catalog version wins transactionally before prior catalog versions are
removed. Cep Depo never deletes external GitHub release assets during update or
permanent application deletion.

In order, the controls are: **GitHub asset upload**, **automatic catalog
publication**, and **rollout enablement**. Completing one does not authorize or
imply completion of any later control. If publication reports that cleanup is
pending, treat publication as successful and inspect the Cep Depo cleanup queue
instead of retrying the publication.

## Recover from failures

- A failure before draft creation leaves no GitHub release.
- An upload failure or pre-publication metadata failure preserves the private
  draft for diagnosis. Inspect it with:

  ```bash
  gh release view TAG --repo SamulVanunu/cep-depo-apks
  ```

- Do not immediately retry with the same tag. The uploader intentionally
  refuses all existing public and draft tags. Inspect the preserved draft,
  then either continue manually or obtain separate approval before deleting
  remote state. Use a new unique tag only when it represents a deliberate new
  release attempt.
- If the final URL probe fails after publication, the release is already
  public. Inspect the reported tag and URL on GitHub; do not assume it remains
  a draft.
- If publication itself reports an error, its final state is unknown. Inspect
  the reported repository and tag on GitHub before taking any further action.
- If post-publication metadata validation fails, the release is already public
  and must be inspected manually.
- If clipboard copying fails, manually copy the direct URL from the success
  dialog.

## Local release gate

Before changing or distributing the uploader, run:

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

Never use a synthetic smoke fixture for Android installation testing or Cep
Depo catalog publication. Real APK publication, catalog changes, deployment,
and rollout enablement each require their own approval.
