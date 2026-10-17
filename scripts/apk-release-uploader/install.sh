#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TEMPLATE="$SCRIPT_DIR/cep-depo-apk-uploader.desktop.template"
UPLOADER_PATH="$SCRIPT_DIR/upload.sh"
APPLICATIONS_DIR="$HOME/.local/share/applications"
LAUNCHER="$APPLICATIONS_DIR/cep-depo-apk-uploader.desktop"
TEMP_LAUNCHER=""

cleanup() {
  if [ -n "$TEMP_LAUNCHER" ] && [ -f "$TEMP_LAUNCHER" ]; then
    rm -f "$TEMP_LAUNCHER"
  fi
}
trap cleanup EXIT

desktop_exec_argument() {
  local value="$1" escaped="" character index

  for ((index = 0; index < ${#value}; index++)); do
    character=${value:index:1}
    case "$character" in
      \\) escaped+='\\\\';;
      '$') escaped+='\\$';;
      '`') escaped+='\\`';;
      '"') escaped+='\\"';;
      '%') escaped+='%%';;
      *) escaped+="$character";;
    esac
  done

  printf '"%s"' "$escaped"
}

if [ ! -f "$TEMPLATE" ] || [ ! -f "$UPLOADER_PATH" ]; then
  echo "Yükleyici dosyaları bulunamadı." >&2
  exit 1
fi

umask 077
mkdir -p "$APPLICATIONS_DIR"
TEMP_LAUNCHER=$(mktemp "$APPLICATIONS_DIR/.cep-depo-apk-uploader.XXXXXX")

desktop_exec_path=$(desktop_exec_argument "$UPLOADER_PATH")
while IFS= read -r template_line || [ -n "$template_line" ]; do
  if [ "$template_line" = 'Exec=@UPLOADER_PATH@' ]; then
    printf 'Exec=%s\n' "$desktop_exec_path"
  else
    printf '%s\n' "$template_line"
  fi
done < "$TEMPLATE" > "$TEMP_LAUNCHER"
chmod 0644 "$TEMP_LAUNCHER"
mv -f "$TEMP_LAUNCHER" "$LAUNCHER"
TEMP_LAUNCHER=""

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi

printf 'Launcher kuruldu: %s\n' "$LAUNCHER"
