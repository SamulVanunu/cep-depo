#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

PROGRESS_OPEN=0

show_error() {
  printf 'Hata: %s\n' "$1" >&2
  "$ZENITY_BIN" --error --title="Cep Depo APK Yükleyici" --text="$1" >/dev/null 2>&1 || true
}

show_info() {
  "$ZENITY_BIN" --info --title="Cep Depo APK Yükleyici" --text="$1" >/dev/null 2>&1 || true
}

trim_whitespace() {
  local value="$1"
  shopt -s extglob
  value=${value##+([[:space:]])}
  value=${value%%+([[:space:]])}
  printf '%s' "$value"
}

open_progress() {
  if [ "${APK_UPLOADER_MODE:-interactive}" = "noninteractive" ]; then
    return 0
  fi

  exec 3> >("$ZENITY_BIN" --progress --title="Cep Depo APK Yükleyici" \
    --text="GitHub taslak sürümü hazırlanıyor..." --percentage=0 --auto-close --no-cancel \
    >/dev/null 2>&1)
  PROGRESS_OPEN=1
}

update_progress() {
  if [ "$PROGRESS_OPEN" -eq 1 ]; then
    printf '%s\n# %s\n' "$1" "$2" >&3
  fi
}

close_progress() {
  if [ "$PROGRESS_OPEN" -eq 1 ]; then
    exec 3>&-
    PROGRESS_OPEN=0
  fi
}

fail_before_draft() {
  close_progress
  show_error "$UPLOAD_ERROR"
  return 1
}

fail_with_preserved_draft() {
  local tag="$1"
  close_progress
  show_error "$UPLOAD_ERROR

Özel taslak korundu. İncelemek veya elle kaldırmak için:
Depo: $GITHUB_REPOSITORY
Etiket: $tag"
  return 1
}

main() {
  local apk_path tag lookup_status size sha256 filename remote_record direct_url message

  if ! require_commands; then
    show_error "$UPLOAD_ERROR"
    return 1
  fi

  if [ "${APK_UPLOADER_MODE:-interactive}" = "noninteractive" ]; then
    apk_path=${APK_UPLOADER_APK_PATH:-}
    if [ -z "$apk_path" ]; then
      set_error "Noninteractive modda APK dosya yolu sağlanmalıdır."
      show_error "$UPLOAD_ERROR"
      return 1
    fi
  else
    if ! apk_path=$("$ZENITY_BIN" --file-selection --title="Yüklenecek APK dosyasını seçin" \
      --file-filter="APK dosyaları | *.apk"); then
      return 0
    fi
  fi

  if [ "${APK_UPLOADER_MODE:-interactive}" = "noninteractive" ]; then
    tag=${APK_UPLOADER_RELEASE_TAG:-}
  else
    if ! tag=$("$ZENITY_BIN" --entry --title="Sürüm etiketi" \
      --text="Sürüm etiketini girin (örnek: hikari-v9):"); then
      return 0
    fi
  fi
  tag=$(trim_whitespace "$tag")

  validate_apk_file "$apk_path" || { show_error "$UPLOAD_ERROR"; return 1; }
  validate_release_tag "$tag" || { show_error "$UPLOAD_ERROR"; return 1; }
  require_github_account || { show_error "$UPLOAD_ERROR"; return 1; }

  if release_exists "$tag"; then
    set_error "Bu sürüm etiketi zaten var: '$tag'. Mevcut sürüm veya taslağı GitHub'da inceleyin."
    show_error "$UPLOAD_ERROR"
    return 1
  else
    lookup_status=$?
  fi
  if [ "$lookup_status" -ne 1 ]; then
    show_error "$UPLOAD_ERROR"
    return "$lookup_status"
  fi

  size=$(apk_size "$apk_path") || { set_error "APK dosya boyutu okunamadı."; fail_before_draft; return 1; }
  sha256=$(apk_sha256 "$apk_path") || { set_error "APK SHA-256 özeti hesaplanamadı."; fail_before_draft; return 1; }
  filename=$(basename "$apk_path")

  open_progress
  update_progress 15 "Özel taslak oluşturuluyor..."
  create_draft_release "$tag" "$sha256" >/dev/null 2>&1 || { fail_before_draft; return 1; }

  update_progress 40 "APK taslağa yükleniyor..."
  upload_release_asset "$tag" "$apk_path" >/dev/null 2>&1 || { fail_with_preserved_draft "$tag"; return 1; }

  update_progress 65 "Uzak APK bilgileri doğrulanıyor..."
  if ! remote_record=$(read_remote_asset "$tag" "$filename" 2>/dev/null); then
    set_error "GitHub asset bilgileri okunamadı veya yüklenen APK bulunamadı."
    fail_with_preserved_draft "$tag"
    return 1
  fi
  validate_remote_asset "$size" "$sha256" "$remote_record" || { fail_with_preserved_draft "$tag"; return 1; }
  direct_url=${remote_record##*$'\t'}

  update_progress 80 "Doğrulanmış taslak yayımlanıyor..."
  if ! publish_release "$tag" >/dev/null 2>&1; then
    close_progress
    show_error "$UPLOAD_ERROR

Yayın durumu doğrulanamadı. GitHub'da elle kontrol edin:
Depo: $GITHUB_REPOSITORY
Etiket: $tag"
    return 1
  fi

  if ! remote_record=$(read_remote_asset "$tag" "$filename" 2>/dev/null); then
    set_error "Yayımlanmış GitHub asset bilgileri okunamadı."
    close_progress
    show_error "$UPLOAD_ERROR

Sürüm yayımlandı; taslak olarak kalmadı. GitHub'da elle kontrol edin:
Depo: $GITHUB_REPOSITORY
Etiket: $tag"
    return 1
  fi
  if ! validate_remote_asset "$size" "$sha256" "$remote_record"; then
    close_progress
    show_error "$UPLOAD_ERROR

Sürüm yayımlandı; taslak olarak kalmadı. GitHub'da elle kontrol edin:
Depo: $GITHUB_REPOSITORY
Etiket: $tag"
    return 1
  fi
  direct_url=${remote_record##*$'\t'}

  update_progress 95 "Yayımlanmış indirme adresi kontrol ediliyor..."
  if ! probe_direct_url "$direct_url" >/dev/null 2>&1; then
    close_progress
    show_error "$UPLOAD_ERROR

Sürüm yayımlandı; taslak olarak kalmadı. Adresi GitHub'da kontrol edin:
Depo: $GITHUB_REPOSITORY
Etiket: $tag
URL: $direct_url"
    return 1
  fi
  update_progress 100 "Tamamlandı."
  close_progress

  message="Yükleme ve yayınlama tamamlandı.

Depo: $GITHUB_REPOSITORY
Etiket: $tag
Boyut: $size bayt
SHA-256: $sha256
Doğrudan URL: $direct_url

Cep Depo admin panelinde aynı APK dosyasını seçmeyi unutmayın."

  if printf '%s' "$direct_url" | "$XCLIP_BIN" -selection clipboard 2>/dev/null; then
    message="$message

Doğrudan URL panoya kopyalandı."
  else
    message="$message

URL panoya kopyalanamadı; yukarıdaki adresi elle kopyalayın."
  fi
  show_info "$message"
  return 0
}

main "$@"
