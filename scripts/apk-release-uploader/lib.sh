#!/usr/bin/env bash
# Desktop APK release uploader — local input validation library.
#
# Sourced by the uploader and its tests; it defines no side effects beyond
# function and constant definitions. All functions take quoted arguments and
# are safe under `set -u`.
#
# Contract: validation functions return 0 on success. On failure they return
# non-zero and set the global UPLOAD_ERROR to operator-safe Turkish text.

# GitHub release asset size limit (2 GiB). Files of exactly this size or
# larger are rejected.
GITHUB_ASSET_MAX_BYTES=2147483648

# ZIP local file header signature every valid APK (a ZIP archive) starts with.
APK_ZIP_MAGIC="504b0304"

# Fixed publication target and replaceable external commands. Tests inject
# local doubles through these variables; normal runs use the system commands.
GITHUB_REPOSITORY="SamulVanunu/cep-depo-apks"
GITHUB_OWNER="SamulVanunu"
GH_BIN=${GH_BIN:-gh}
CURL_BIN=${CURL_BIN:-curl}
UNZIP_BIN=${UNZIP_BIN:-unzip}
SHA256_BIN=${SHA256_BIN:-sha256sum}
XCLIP_BIN=${XCLIP_BIN:-xclip}
ZENITY_BIN=${ZENITY_BIN:-zenity}

# set_error <message>
#
# Sets the global UPLOAD_ERROR shown to the operator.
set_error() {
  UPLOAD_ERROR="$1"
}

# validate_release_tag <tag>
#
# Accepts non-empty tags made only of letters, digits, dots, underscores and
# hyphens (e.g. hikari-v9). Returns non-zero otherwise.
validate_release_tag() {
  local tag="$1"

  if [ -z "$tag" ]; then
    set_error "Sürüm etiketi boş olamaz."
    return 1
  fi

  # tr_TR.UTF-8 yerelinde [A-Za-z] aralığı 'i' harfini düzgün
  # kapsayabildiği için regex değerlendirmesi C yerelinde yapılır.
  if ! (LC_ALL=C; [[ "$tag" =~ ^[A-Za-z0-9._-]+$ ]]); then
    set_error "Geçersiz sürüm etiketi: '$tag'. Sadece harf, rakam, nokta, alt çizgi ve tire kullanılabilir."
    return 1
  fi

  return 0
}

# validate_apk_file <path>
#
# Validates a local APK before upload: the path must exist and be a regular
# file, carry the .apk extension, start with the ZIP signature, be smaller
# than GITHUB_ASSET_MAX_BYTES, and pass a complete ZIP integrity check.
validate_apk_file() {
  local path="$1"
  local size magic

  if [ ! -f "$path" ]; then
    set_error "APK dosyası bulunamadı: '$path'."
    return 1
  fi

  case "$path" in
    *.apk) ;;
    *)
      set_error "APK dosyası .apk uzantılı olmalı: '$path'."
      return 1
      ;;
  esac

  magic=$(od -An -tx1 -N4 "$path" 2>/dev/null | tr -d ' \n')
  if [ "$magic" != "$APK_ZIP_MAGIC" ]; then
    set_error "Geçersiz APK dosyası (ZIP başlığı bulunamadı): '$path'."
    return 1
  fi

  size=$(apk_size "$path")
  if [ "$size" -ge "$GITHUB_ASSET_MAX_BYTES" ]; then
    set_error "APK dosya boyutu 2 GiB GitHub sınırını aşıyor: '$path'."
    return 1
  fi

  if ! "$UNZIP_BIN" -tq "$path" >/dev/null 2>&1; then
    set_error "Bozuk APK dosyası (ZIP bütünlüğü doğrulanamadı): '$path'."
    return 1
  fi

  return 0
}

# apk_size <path>
#
# Prints the file size in bytes (same result as `stat -c %s`).
apk_size() {
  stat -c %s "$1"
}

# apk_sha256 <path>
#
# Prints the lowercase SHA-256 hex digest (same result as `sha256sum`).
apk_sha256() {
  "$SHA256_BIN" "$1" | awk '{print $1}'
}

# require_commands
#
# Fails closed unless every command needed by the desktop uploader is
# available. Configured command paths are honored for deterministic tests.
require_commands() {
  local names=(zenity gh sha256sum unzip curl xclip)
  local commands=("$ZENITY_BIN" "$GH_BIN" "$SHA256_BIN" "$UNZIP_BIN" "$CURL_BIN" "$XCLIP_BIN")
  local index

  for index in "${!commands[@]}"; do
    if ! command -v "${commands[$index]}" >/dev/null 2>&1; then
      set_error "Gerekli komut bulunamadı: ${names[$index]}."
      return 1
    fi
  done

  return 0
}

# require_github_account
#
# Verifies the active gh keyring session without reading credentials.
require_github_account() {
  local login login_lower owner_lower

  if ! login=$("$GH_BIN" api user --jq .login 2>/dev/null); then
    set_error "GitHub hesabı doğrulanamadı. 'gh auth login' ile oturum açın."
    return 1
  fi

  login_lower=$(printf '%s' "$login" | LC_ALL=C tr '[:upper:]' '[:lower:]')
  owner_lower=$(printf '%s' "$GITHUB_OWNER" | LC_ALL=C tr '[:upper:]' '[:lower:]')
  if [ "$login_lower" != "$owner_lower" ]; then
    set_error "Etkin GitHub hesabı '$GITHUB_OWNER' olmalı."
    return 1
  fi

  return 0
}

# release_exists <tag>
#
# Lists releases through the authenticated API so public and draft tags are
# both visible. Returns 0 when the exact tag exists, 1 when a successful lookup
# confirms absence, and 2 when the lookup itself fails.
release_exists() {
  local tag="$1" response existing_tag

  if ! response=$("$GH_BIN" api "repos/$GITHUB_REPOSITORY/releases?per_page=100" \
    --paginate --jq '.[].tag_name' 2>/dev/null); then
    set_error "GitHub sürüm etiketleri sorgulanamadı. Ağ bağlantısını ve yetkilendirmeyi kontrol edin."
    return 2
  fi

  while IFS= read -r existing_tag || [ -n "$existing_tag" ]; do
    if [ "$existing_tag" = "$tag" ]; then
      return 0
    fi
  done <<< "$response"

  return 1
}

# create_draft_release <tag> <sha256>
create_draft_release() {
  local tag="$1" sha256="$2"

  if ! "$GH_BIN" release create "$tag" --repo "$GITHUB_REPOSITORY" --draft \
    --notes "SHA-256: $sha256" >/dev/null; then
    set_error "GitHub taslak sürümü oluşturulamadı."
    return 1
  fi
}

# upload_release_asset <tag> <apk_path>
upload_release_asset() {
  local tag="$1" apk_path="$2"

  if ! "$GH_BIN" release upload "$tag" "$apk_path" --repo "$GITHUB_REPOSITORY" >/dev/null; then
    set_error "APK GitHub taslak sürümüne yüklenemedi."
    return 1
  fi
}

# read_remote_asset <tag> <filename>
#
# Emits the matching asset as: state, size, digest, content_type and
# browser_download_url, separated by tabs.
read_remote_asset() {
  local tag="$1" filename="$2" response line release_tag asset_name record rest

  # GitHub's release-by-tag endpoint returns 404 for draft releases. List the
  # authenticated repository releases instead so metadata can be verified
  # before the draft crosses the publication boundary.
  if ! response=$("$GH_BIN" api "repos/$GITHUB_REPOSITORY/releases?per_page=100" \
    --paginate --jq '.[] | .tag_name as $tag | .assets[]? | [$tag, .name, .state, (.size | tostring), (.digest // ""), .content_type, .browser_download_url] | @tsv'); then
    set_error "GitHub asset bilgileri okunamadı."
    return 1
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *$'\t'*)
        release_tag=${line%%$'\t'*}
        rest=${line#*$'\t'}
        asset_name=${rest%%$'\t'*}
        record=${rest#*$'\t'}
        if [ "$release_tag" = "$tag" ] && [ "$asset_name" = "$filename" ]; then
          printf '%s\n' "$record"
          return 0
        fi
        ;;
    esac
  done <<< "$response"

  set_error "Yüklenen APK GitHub sürümünde bulunamadı."
  return 1
}

# validate_remote_asset <local_size> <local_sha256> <remote_record>
validate_remote_asset() {
  local local_size="$1" local_sha256="$2" record="$3"
  local state size digest content_type url rest prefix

  case "$record" in
    *$'\n'*)
      set_error "GitHub asset bilgileri geçersiz."
      return 1
      ;;
  esac

  state=${record%%$'\t'*}
  if [ "$state" = "$record" ]; then
    set_error "GitHub asset bilgileri eksik."
    return 1
  fi
  rest=${record#*$'\t'}
  size=${rest%%$'\t'*}
  [ "$size" != "$rest" ] || { set_error "GitHub asset bilgileri eksik."; return 1; }
  rest=${rest#*$'\t'}
  digest=${rest%%$'\t'*}
  [ "$digest" != "$rest" ] || { set_error "GitHub asset bilgileri eksik."; return 1; }
  rest=${rest#*$'\t'}
  content_type=${rest%%$'\t'*}
  [ "$content_type" != "$rest" ] || { set_error "GitHub asset bilgileri eksik."; return 1; }
  url=${rest#*$'\t'}
  case "$url" in *$'\t'*) set_error "GitHub asset bilgileri geçersiz."; return 1;; esac

  if [ "$state" != "uploaded" ]; then
    set_error "GitHub asset yükleme durumu tamamlanmadı."
    return 1
  fi
  if [ "$size" != "$local_size" ]; then
    set_error "GitHub asset boyutu yerel APK ile eşleşmiyor."
    return 1
  fi
  if [ -z "$digest" ] || [ "$digest" != "sha256:$local_sha256" ]; then
    set_error "GitHub asset SHA-256 özeti yerel APK ile eşleşmiyor."
    return 1
  fi
  case "$content_type" in
    application/vnd.android.package-archive|application/octet-stream) ;;
    *)
      set_error "GitHub asset içerik türü APK için geçersiz."
      return 1
      ;;
  esac

  prefix="https://github.com/$GITHUB_REPOSITORY/releases/download/"
  case "$url" in
    "$prefix"?*) ;;
    *)
      set_error "GitHub asset indirme adresi geçersiz."
      return 1
      ;;
  esac
  case "$url" in
    *'?'*|*'#'*)
      set_error "GitHub asset indirme adresi query veya fragment içeremez."
      return 1
      ;;
  esac

  return 0
}

# publish_release <tag>
publish_release() {
  if ! "$GH_BIN" release edit "$1" --repo "$GITHUB_REPOSITORY" --draft=false >/dev/null; then
    set_error "GitHub taslak sürümü yayımlanamadı."
    return 1
  fi
}

# probe_direct_url <url>
probe_direct_url() {
  local url="$1" prefix
  prefix="https://github.com/$GITHUB_REPOSITORY/releases/download/"

  case "$url" in
    "$prefix"?*) ;;
    *)
      set_error "Doğrudan APK adresi sabit GitHub deposuna ait değil."
      return 1
      ;;
  esac
  case "$url" in
    *'?'*|*'#'*)
      set_error "Doğrudan APK adresi query veya fragment içeremez."
      return 1
      ;;
  esac

  if ! "$CURL_BIN" --fail --silent --show-error --location --head --max-time 30 "$url"; then
    set_error "Doğrudan APK adresine HTTPS ile erişilemedi."
    return 1
  fi
}
