#!/usr/bin/env bash
# Test groups for the desktop APK release uploader.
#
# Usage:
#   bash scripts/apk-release-uploader/tests/run.sh validation|github|workflow|all
#
# Exits 0 when every case passes, 1 otherwise.

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LIB="$SCRIPT_DIR/../lib.sh"
ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
FIXTURE="$ROOT/admin/e2e/fixtures/test.apk"

GROUP=${1:-validation}
case "$GROUP" in
  validation|github|workflow|all) ;;
  *)
    echo "Bilinmeyen test grubu: $GROUP (beklenen: validation, github, workflow veya all)" >&2
    exit 2
    ;;
esac

# shellcheck source=../lib.sh
source "$LIB"

PASS=0
FAIL=0

pass() {
  PASS=$((PASS + 1))
  echo "PASS: $1"
}

fail() {
  FAIL=$((FAIL + 1))
  echo "FAIL: $1"
}

# expect_ok <name> <command> [args...]
expect_ok() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    pass "$name"
  else
    fail "$name"
  fi
}

# expect_fail <name> <command> [args...]
expect_fail() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    fail "$name"
  else
    pass "$name"
  fi
}

# expect_fail_with_error <name> <command> [args...]
# Fails the case when the command succeeds or UPLOAD_ERROR stays empty.
expect_fail_with_error() {
  local name="$1"
  shift
  UPLOAD_ERROR=""
  if "$@" >/dev/null 2>&1; then
    fail "$name"
  elif [ -z "${UPLOAD_ERROR:-}" ]; then
    fail "$name (UPLOAD_ERROR boş)"
  else
    pass "$name"
  fi
}

expect_equal() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$name"
  else
    fail "$name (beklenen: '$expected', gelen: '$actual')"
  fi
}

expect_status() {
  local name="$1" expected="$2" actual
  shift 2
  "$@" >/dev/null 2>&1
  actual=$?
  if [ "$actual" -eq "$expected" ]; then
    pass "$name"
  else
    fail "$name (beklenen durum: $expected, gelen: $actual)"
  fi
}

expect_status_with_error() {
  local name="$1" expected="$2" actual
  shift 2
  UPLOAD_ERROR=""
  "$@" >/dev/null 2>&1
  actual=$?
  if [ "$actual" -ne "$expected" ]; then
    fail "$name (beklenen durum: $expected, gelen: $actual)"
  elif [ -z "${UPLOAD_ERROR:-}" ]; then
    fail "$name (UPLOAD_ERROR boş)"
  else
    pass "$name"
  fi
}

expect_log_absent() {
  local name="$1"
  local pattern="$2"
  if grep -q "$pattern" "$GH_LOG"; then
    fail "$name"
  else
    pass "$name"
  fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Structurally valid but non-installable APK ZIP, built with the system zip.
mkdir -p "$TMP/apkdir"
echo "dummy" > "$TMP/apkdir/content.txt"
(cd "$TMP" && zip -q -r valid.apk apkdir)

# Same archive under a directory containing spaces and the Turkish İ.
mkdir -p "$TMP/dizin boşluk"
cp "$TMP/valid.apk" "$TMP/dizin boşluk/İ test.apk"

# Negative fixtures.
: > "$TMP/empty.apk"
printf 'NOTAPK' > "$TMP/wrong-magic.apk"
(cd "$TMP" && zip -q -r archive.zip apkdir)
printf 'PK\x03\x04' > "$TMP/huge.apk"
truncate -s 2147483648 "$TMP/huge.apk"

run_validation_tests() {
  echo "== Sürüm etiketi doğrulama =="
  expect_ok "hikari-v9 kabul edilir" validate_release_tag "hikari-v9"
  expect_fail_with_error "boş etiket reddedilir" validate_release_tag ""
  expect_fail_with_error "etikette boşluk reddedilir" validate_release_tag " "
  expect_fail_with_error "etikte slash reddedilir" validate_release_tag "foo/bar"
  expect_fail_with_error "etikte kabuk metakarakteri reddedilir" validate_release_tag 'foo;touch /tmp/pwned'

  echo "== APK dosya doğrulama =="
  expect_ok "geçerli geçici APK kabul edilir" validate_apk_file "$TMP/valid.apk"
  expect_fail_with_error "eksik dosya reddedilir" validate_apk_file "$TMP/yok.apk"
  expect_fail_with_error "boş dosya reddedilir" validate_apk_file "$TMP/empty.apk"
  expect_fail_with_error ".zip uzantısı reddedilir" validate_apk_file "$TMP/archive.zip"
  expect_fail_with_error "yanlış magic baytları reddedilir" validate_apk_file "$TMP/wrong-magic.apk"
  expect_fail_with_error "bozuk ZIP (mevcut fixture) reddedilir" validate_apk_file "$FIXTURE"
  expect_fail_with_error "tam 2 GiB dosya reddedilir" validate_apk_file "$TMP/huge.apk"
  expect_ok "boşluk ve İ içeren yol kabul edilir" validate_apk_file "$TMP/dizin boşluk/İ test.apk"

  echo "== Boyut ve SHA-256 =="
  EXPECTED_SIZE=$(stat -c %s "$TMP/valid.apk")
  ACTUAL_SIZE=$(apk_size "$TMP/valid.apk")
  expect_equal "apk_size stat -c %s sonucuna eşittir" "$EXPECTED_SIZE" "$ACTUAL_SIZE"

  EXPECTED_SHA=$(sha256sum "$TMP/valid.apk" | awk '{print $1}')
  ACTUAL_SHA=$(apk_sha256 "$TMP/valid.apk")
  expect_equal "apk_sha256 sha256sum sonucuna eşittir" "$EXPECTED_SHA" "$ACTUAL_SHA"
}

GH_LOG="$TMP/gh.log"
GH_MOCK="$TMP/gh-mock"
CURL_LOG="$TMP/curl.log"
CURL_MOCK="$TMP/curl-mock"

cat > "$GH_MOCK" <<'EOF'
#!/usr/bin/env bash
set -u
case "${1:-} ${2:-}" in
  "api user")
    [ -z "${WORKFLOW_LOG:-}" ] || printf 'guard\n' >> "$WORKFLOW_LOG"
    printf '%s\n' "${MOCK_GITHUB_LOGIN:-SamulVanunu}"
    ;;
  "api repos/SamulVanunu/cep-depo-apks/releases?per_page=100")
    [ "$3" = "--paginate" ] && [ "$4" = "--jq" ] || exit 2
    if [ "$5" = '.[].tag_name' ]; then
      printf 'lookup:%s\n' "${MOCK_RELEASE_KIND:-missing}" >> "$GH_LOG"
      [ -z "${WORKFLOW_LOG:-}" ] || printf 'lookup:%s\n' "${MOCK_RELEASE_KIND:-missing}" >> "$WORKFLOW_LOG"
      case "${MOCK_RELEASE_KIND:-missing}" in
        public|draft) printf '%s\n' "${MOCK_EXISTING_TAG:-test-v1}";;
        near) printf '%s\n' 'test-v10';;
        missing) ;;
        error) exit 1;;
        *) exit 2;;
      esac
    else
      printf 'read:test-v1\n' >> "$GH_LOG"
      [ -z "${WORKFLOW_LOG:-}" ] || printf 'metadata:test-v1\n' >> "$WORKFLOW_LOG"
      [ "${MOCK_METADATA_RESULT:-success}" = "success" ] || exit 1
      remote_record=${MOCK_REMOTE_RECORD:-}
      if grep -q '^publish:test-v1$' "$GH_LOG" && [ -n "${MOCK_PUBLISHED_REMOTE_RECORD:-}" ]; then
        remote_record=$MOCK_PUBLISHED_REMOTE_RECORD
      fi
      if [ -n "$remote_record" ]; then
        printf 'test-v1\t%s\t%s\n' "$MOCK_ASSET_NAME" "$remote_record"
      fi
    fi
    ;;
  "release create")
    printf 'create:%s\n' "$3" >> "$GH_LOG"
    [ -z "${WORKFLOW_LOG:-}" ] || printf 'create:%s\n' "$3" >> "$WORKFLOW_LOG"
    [ "$#" -eq 8 ] && [ "$4" = "--repo" ] && [ "$5" = "SamulVanunu/cep-depo-apks" ] &&
      [ "$6" = "--draft" ] && [ "$7" = "--notes" ] && [ "$8" = "SHA-256: $MOCK_SHA256" ] &&
      [ "${MOCK_CREATE_RESULT:-success}" = "success" ]
    ;;
  "release upload")
    printf 'upload:%s\n' "$3" >> "$GH_LOG"
    [ -z "${WORKFLOW_LOG:-}" ] || printf 'upload:%s\n' "$3" >> "$WORKFLOW_LOG"
    [ "${MOCK_UPLOAD_RESULT:-success}" = "success" ] || printf 'RAW_UPLOAD_COMMAND_OUTPUT\n' >&2
    [ "$#" -eq 6 ] && [ "$4" = "$MOCK_APK_PATH" ] && [ "$5" = "--repo" ] &&
      [ "$6" = "SamulVanunu/cep-depo-apks" ] && [ "${MOCK_UPLOAD_RESULT:-success}" = "success" ]
    ;;
  "release edit")
    printf 'publish:%s\n' "$3" >> "$GH_LOG"
    [ -z "${WORKFLOW_LOG:-}" ] || printf 'publish:%s\n' "$3" >> "$WORKFLOW_LOG"
    [ "$#" -eq 6 ] && [ "$4" = "--repo" ] && [ "$5" = "SamulVanunu/cep-depo-apks" ] &&
      [ "$6" = "--draft=false" ] && [ "${MOCK_PUBLISH_RESULT:-success}" = "success" ]
    ;;
  *) exit 2;;
esac
EOF
chmod +x "$GH_MOCK"

cat > "$CURL_MOCK" <<'EOF'
#!/usr/bin/env bash
set -u
printf '%s\n' "$*" >> "$CURL_LOG"
[ -z "${WORKFLOW_LOG:-}" ] || printf 'probe:%s\n' "$8" >> "$WORKFLOW_LOG"
[ "${MOCK_CURL_RESULT:-success}" = "success" ] || printf 'RAW_CURL_COMMAND_OUTPUT\n' >&2
[ "$#" -eq 8 ] && [ "$1" = "--fail" ] && [ "$2" = "--silent" ] &&
  [ "$3" = "--show-error" ] && [ "$4" = "--location" ] && [ "$5" = "--head" ] &&
  [ "$6" = "--max-time" ] && [ "$7" = "30" ] && [ "$8" = "$MOCK_DIRECT_URL" ] &&
  [ "${MOCK_CURL_RESULT:-success}" = "success" ]
EOF
chmod +x "$CURL_MOCK"

ZENITY_LOG="$TMP/zenity.log"
ZENITY_MOCK="$TMP/zenity-mock"
XCLIP_LOG="$TMP/xclip.log"
XCLIP_MOCK="$TMP/xclip-mock"
WORKFLOW_LOG="$TMP/workflow.log"

cat > "$ZENITY_MOCK" <<'EOF'
#!/usr/bin/env bash
set -u
printf '%s\n' "$*" >> "$ZENITY_LOG"
case "${1:-}" in
  --file-selection)
    [ "${MOCK_CHOOSER_RESULT:-selected}" = "selected" ] || exit 1
    printf '%s\n' "$MOCK_APK_PATH"
    ;;
  --entry)
    [ "${MOCK_ENTRY_RESULT:-selected}" = "selected" ] || exit 1
    printf '%s\n' "${MOCK_RELEASE_TAG:-test-v1}"
    ;;
  --progress) cat >/dev/null;;
esac
EOF
chmod +x "$ZENITY_MOCK"

cat > "$XCLIP_MOCK" <<'EOF'
#!/usr/bin/env bash
set -u
[ "$#" -eq 2 ] && [ "$1" = "-selection" ] && [ "$2" = "clipboard" ] || exit 2
cat > "$XCLIP_LOG"
[ "${MOCK_XCLIP_RESULT:-success}" = "success" ]
EOF
chmod +x "$XCLIP_MOCK"

run_mock_transaction() {
  local tag="$1" apk_path="$2" size="$3" sha256="$4" filename record lookup_status
  filename=$(basename "$apk_path")
  if release_exists "$tag"; then
    set_error "Bu sürüm etiketi zaten var."
    return 1
  else
    lookup_status=$?
  fi
  [ "$lookup_status" -eq 1 ] || return "$lookup_status"
  create_draft_release "$tag" "$sha256" || return 1
  upload_release_asset "$tag" "$apk_path" || return 1
  record=$(read_remote_asset "$tag" "$filename") || return 1
  validate_remote_asset "$size" "$sha256" "$record" || return 1
  publish_release "$tag"
}

run_github_tests() {
  local apk_path="$TMP/dizin boşluk/İ test.apk"
  local size sha256 filename good_url good_record output expected_order
  size=$(stat -c %s "$apk_path")
  sha256=$(sha256sum "$apk_path" | awk '{print $1}')
  filename=$(basename "$apk_path")
  good_url="https://github.com/SamulVanunu/cep-depo-apks/releases/download/test-v1/%C4%B0.test.apk"
  good_record=$(printf 'uploaded\t%s\tsha256:%s\tapplication/vnd.android.package-archive\t%s' "$size" "$sha256" "$good_url")

  export GH_LOG CURL_LOG MOCK_SHA256="$sha256" MOCK_APK_PATH="$apk_path" MOCK_ASSET_NAME="$filename"
  GH_BIN="$GH_MOCK"
  CURL_BIN="$CURL_MOCK"
  ZENITY_BIN=/bin/true
  SHA256_BIN=/usr/bin/sha256sum
  UNZIP_BIN=/usr/bin/unzip
  XCLIP_BIN=/bin/true

  echo "== Komut ve GitHub hesap korumaları =="
  expect_ok "gerekli komutlar mevcutsa kontrol geçer" require_commands
  CURL_BIN="$TMP/olmayan-curl"
  expect_fail_with_error "eksik gerekli komut kapalı kalır" require_commands
  CURL_BIN="$CURL_MOCK"
  MOCK_GITHUB_LOGIN=sAmUlVaNuNu expect_ok "GitHub hesabı büyük/küçük harften bağımsız eşleşir" require_github_account
  MOCK_GITHUB_LOGIN=other-user expect_fail_with_error "yanlış GitHub hesabı kapalı kalır" require_github_account

  echo "== Taslak-önce GitHub işlemi =="
  : > "$GH_LOG"
  MOCK_RELEASE_KIND=public expect_status "public tag listede bulunur" 0 release_exists test-v1
  MOCK_RELEASE_KIND=draft expect_status "draft tag listede bulunur" 0 release_exists test-v1
  MOCK_RELEASE_KIND=near expect_status "yalnız exact tag eşleşir ve yakın tag yok sayılır" 1 release_exists test-v1
  MOCK_RELEASE_KIND=missing expect_status "başarılı boş liste yokluğu doğrular" 1 release_exists test-v1
  MOCK_RELEASE_KIND=error expect_status_with_error "lookup komut hatası ayrı ve güvenli hata döndürür" 2 release_exists test-v1

  : > "$GH_LOG"
  MOCK_RELEASE_KIND=error expect_fail_with_error "lookup hatası işlemi durdurur" run_mock_transaction test-v1 "$apk_path" "$size" "$sha256"
  expect_log_absent "lookup hatasında create/upload yapılmaz" 'create:\|upload:'

  : > "$GH_LOG"
  MOCK_RELEASE_KIND=public expect_fail_with_error "mevcut public release işlemi durdurur" run_mock_transaction test-v1 "$apk_path" "$size" "$sha256"
  expect_log_absent "public release varsa create/upload yapılmaz" 'create:\|upload:'
  : > "$GH_LOG"
  MOCK_RELEASE_KIND=draft expect_fail_with_error "mevcut draft release işlemi durdurur" run_mock_transaction test-v1 "$apk_path" "$size" "$sha256"
  expect_log_absent "draft release varsa create/upload yapılmaz" 'create:\|upload:'

  : > "$GH_LOG"
  export MOCK_RELEASE_KIND=missing MOCK_REMOTE_RECORD="$good_record"
  expect_ok "doğrulanmış asset taslağı yayımlar" run_mock_transaction test-v1 "$apk_path" "$size" "$sha256"
  expected_order=$(printf 'lookup:missing\ncreate:test-v1\nupload:test-v1\nread:test-v1\npublish:test-v1')
  output=$(cat "$GH_LOG")
  expect_equal "create upload ve publish doğru sıradadır" "$expected_order" "$output"

  output=$(read_remote_asset test-v1 "$filename")
  expect_equal "uzak asset kaydı beş alanlı TSV döner" "$good_record" "$output"
  expect_ok "octet-stream içerik türü kabul edilir" validate_remote_asset "$size" "$sha256" "${good_record/application\/vnd.android.package-archive/application\/octet-stream}"

  echo "== Uzak asset metadata reddetmeleri =="
  local bad_name bad_record
  while IFS='|' read -r bad_name bad_record; do
    : > "$GH_LOG"
    export MOCK_REMOTE_RECORD="$bad_record"
    expect_fail_with_error "$bad_name" run_mock_transaction test-v1 "$apk_path" "$size" "$sha256"
    expect_log_absent "$bad_name yayınlamaz" '^publish:'
  done <<EOF
state eşleşmez|processing	$size	sha256:$sha256	application/vnd.android.package-archive	$good_url
boyut eşleşmez|uploaded	$((size + 1))	sha256:$sha256	application/vnd.android.package-archive	$good_url
digest eşleşmez|uploaded	$size	sha256:0000	application/vnd.android.package-archive	$good_url
digest eksiktir|uploaded	$size		application/vnd.android.package-archive	$good_url
içerik türü reddedilir|uploaded	$size	sha256:$sha256	text/html	$good_url
credentials reddedilir|uploaded	$size	sha256:$sha256	application/vnd.android.package-archive	https://user@github.com/SamulVanunu/cep-depo-apks/releases/download/test-v1/app.apk
query reddedilir|uploaded	$size	sha256:$sha256	application/vnd.android.package-archive	${good_url}?token=x
fragment reddedilir|uploaded	$size	sha256:$sha256	application/vnd.android.package-archive	${good_url}#x
yanlış host reddedilir|uploaded	$size	sha256:$sha256	application/vnd.android.package-archive	https://example.com/SamulVanunu/cep-depo-apks/releases/download/test-v1/app.apk
yanlış path reddedilir|uploaded	$size	sha256:$sha256	application/vnd.android.package-archive	https://github.com/SamulVanunu/other/releases/download/test-v1/app.apk
EOF

  echo "== Doğrudan URL probu =="
  export MOCK_DIRECT_URL="$good_url" MOCK_CURL_RESULT=success
  : > "$CURL_LOG"
  expect_ok "HTTPS URL redirect izleyen başarılı HEAD ile kabul edilir" probe_direct_url "$good_url"
  expect_equal "curl güvenli sabit seçeneklerle çağrılır" "--fail --silent --show-error --location --head --max-time 30 $good_url" "$(cat "$CURL_LOG")"
  MOCK_CURL_RESULT=failure expect_fail_with_error "başarısız HTTP probu reddedilir" probe_direct_url "$good_url"
  expect_fail_with_error "HTTP doğrudan URL reddedilir" probe_direct_url "http://github.com/SamulVanunu/cep-depo-apks/releases/download/test-v1/app.apk"
  expect_fail_with_error "query içeren doğrudan URL reddedilir" probe_direct_url "${good_url}?x=1"
  expect_fail_with_error "fragment içeren doğrudan URL reddedilir" probe_direct_url "${good_url}#x"
  expect_fail_with_error "credentials içeren doğrudan URL reddedilir" probe_direct_url "https://user@github.com/SamulVanunu/cep-depo-apks/releases/download/test-v1/app.apk"
}

run_uploader() {
  APK_UPLOADER_MODE="${APK_UPLOADER_MODE:-noninteractive}" \
    APK_UPLOADER_APK_PATH="${APK_UPLOADER_APK_PATH:-}" \
    APK_UPLOADER_RELEASE_TAG="${APK_UPLOADER_RELEASE_TAG:-}" \
    bash "$ROOT/apk-release-uploader/upload.sh" >"$TMP/upload.out" 2>"$TMP/upload.err"
}

expect_uploader_status() {
  local name="$1" expected="$2" actual
  run_uploader
  actual=$?
  if [ "$actual" -eq "$expected" ]; then
    pass "$name"
  else
    fail "$name (beklenen durum: $expected, gelen: $actual)"
  fi
}

reset_workflow() {
  : > "$GH_LOG"
  : > "$CURL_LOG"
  : > "$ZENITY_LOG"
  : > "$XCLIP_LOG"
  : > "$WORKFLOW_LOG"
  export MOCK_CHOOSER_RESULT=selected MOCK_ENTRY_RESULT=selected
  export MOCK_CREATE_RESULT=success MOCK_UPLOAD_RESULT=success MOCK_METADATA_RESULT=success
  export MOCK_PUBLISH_RESULT=success MOCK_CURL_RESULT=success MOCK_XCLIP_RESULT=success
  export MOCK_RELEASE_KIND=missing MOCK_GITHUB_LOGIN=SamulVanunu
  export MOCK_REMOTE_RECORD="$MOCK_GOOD_REMOTE_RECORD"
  export MOCK_PUBLISHED_REMOTE_RECORD="$MOCK_GOOD_PUBLISHED_REMOTE_RECORD"
  export APK_UPLOADER_MODE=noninteractive APK_UPLOADER_APK_PATH="$TMP/dizin boşluk/İ test.apk"
  export APK_UPLOADER_RELEASE_TAG=test-v1
}

run_workflow_tests() {
  local apk_path="$TMP/dizin boşluk/İ test.apk"
  local size sha256 filename draft_url draft_record good_url good_record expected_order launcher launcher_first installer_home uploader_path installer_bundle
  size=$(stat -c %s "$apk_path")
  sha256=$(sha256sum "$apk_path" | awk '{print $1}')
  filename=$(basename "$apk_path")
  draft_url="https://github.com/SamulVanunu/cep-depo-apks/releases/download/untagged-draft/%C4%B0.test.apk"
  good_url="https://github.com/SamulVanunu/cep-depo-apks/releases/download/test-v1/%C4%B0.test.apk"
  draft_record=$(printf 'uploaded\t%s\tsha256:%s\tapplication/vnd.android.package-archive\t%s' "$size" "$sha256" "$draft_url")
  good_record=$(printf 'uploaded\t%s\tsha256:%s\tapplication/vnd.android.package-archive\t%s' "$size" "$sha256" "$good_url")

  export GH_LOG CURL_LOG ZENITY_LOG XCLIP_LOG WORKFLOW_LOG
  export GH_BIN="$GH_MOCK" CURL_BIN="$CURL_MOCK" ZENITY_BIN="$ZENITY_MOCK" XCLIP_BIN="$XCLIP_MOCK"
  export SHA256_BIN=/usr/bin/sha256sum UNZIP_BIN=/usr/bin/unzip
  export MOCK_SHA256="$sha256" MOCK_APK_PATH="$apk_path" MOCK_ASSET_NAME="$filename"
  export MOCK_DIRECT_URL="$good_url" MOCK_REMOTE_RECORD="$draft_record" MOCK_GOOD_REMOTE_RECORD="$draft_record"
  export MOCK_PUBLISHED_REMOTE_RECORD="$good_record" MOCK_GOOD_PUBLISHED_REMOTE_RECORD="$good_record"

  echo "== Uçtan uca yükleyici iş akışı =="
  reset_workflow
  export APK_UPLOADER_MODE=interactive MOCK_CHOOSER_RESULT=cancelled
  expect_uploader_status "dosya seçici iptali temiz başarıyla çıkar" 0
  expect_equal "dosya seçici iptalinde GitHub çağrısı yapılmaz" "" "$(cat "$GH_LOG")"

  reset_workflow
  export APK_UPLOADER_APK_PATH=""
  expect_uploader_status "noninteractive boş APK yolu hatayla çıkar" 1
  expect_equal "noninteractive boş APK yolunda GitHub çağrısı yapılmaz" "" "$(cat "$GH_LOG")"
  if grep -qi "APK.*yolu" "$ZENITY_LOG" "$TMP/upload.err"; then pass "noninteractive boş APK yolu güvenli hata gösterir"; else fail "noninteractive boş APK yolu güvenli hata gösterir"; fi

  reset_workflow
  export APK_UPLOADER_APK_PATH="$TMP/yok.apk"
  expect_uploader_status "geçersiz dosya taslak öncesi reddedilir" 1
  expect_log_absent "geçersiz dosyada taslak oluşturulmaz" '^create:'
  if grep -q "APK dosyası bulunamadı" "$ZENITY_LOG" "$TMP/upload.err"; then pass "dosya UPLOAD_ERROR operatöre gösterilir"; else fail "dosya UPLOAD_ERROR operatöre gösterilir"; fi

  reset_workflow
  export APK_UPLOADER_RELEASE_TAG='bad/tag'
  expect_uploader_status "geçersiz etiket taslak öncesi reddedilir" 1
  expect_log_absent "geçersiz etikette taslak oluşturulmaz" '^create:'
  if grep -q "Geçersiz sürüm etiketi" "$ZENITY_LOG" "$TMP/upload.err"; then pass "etiket UPLOAD_ERROR operatöre gösterilir"; else fail "etiket UPLOAD_ERROR operatöre gösterilir"; fi

  reset_workflow
  expect_uploader_status "geçerli girdi yayımlama işlemini tamamlar" 0
  expected_order=$(printf 'guard\nlookup:missing\ncreate:test-v1\nupload:test-v1\nmetadata:test-v1\npublish:test-v1\nmetadata:test-v1\nprobe:%s' "$good_url")
  expect_equal "guard taslak upload metadata publish probe sırası korunur" "$expected_order" "$(cat "$WORKFLOW_LOG")"
  expect_equal "boşluklu ve non-ASCII APK yolu upload'a tek argüman gider" "upload:test-v1" "$(grep '^upload:' "$GH_LOG")"
  expect_equal "başarıda panoya yalnız doğrulanmış URL yazılır" "$good_url" "$(cat "$XCLIP_LOG")"
  if grep -q "SamulVanunu/cep-depo-apks" "$ZENITY_LOG" && grep -q "test-v1" "$ZENITY_LOG" &&
    grep -q "$sha256" "$ZENITY_LOG" && grep -q "$good_url" "$ZENITY_LOG" && grep -q "admin panel" "$ZENITY_LOG"; then
    pass "başarı özeti depo etiket hash URL ve admin hatırlatmasını gösterir"
  else
    fail "başarı özeti depo etiket hash URL ve admin hatırlatmasını gösterir"
  fi

  reset_workflow
  export MOCK_UPLOAD_RESULT=failure
  expect_uploader_status "upload hatası başarısız çıkar" 1
  if grep -q '^create:test-v1$' "$GH_LOG"; then pass "upload hatasından önce taslak oluşturulur"; else fail "upload hatasından önce taslak oluşturulur"; fi
  expect_log_absent "upload hatasında publish çağrılmaz" '^publish:'
  if grep -q "SamulVanunu/cep-depo-apks" "$ZENITY_LOG" && grep -q "test-v1" "$ZENITY_LOG" && grep -qi "taslak" "$ZENITY_LOG"; then
    pass "upload hatası korunan taslağın depo ve etiketini bildirir"
  else
    fail "upload hatası korunan taslağın depo ve etiketini bildirir"
  fi
  if grep -q 'RAW_UPLOAD_COMMAND_OUTPUT' "$TMP/upload.err"; then fail "upload komut çıktısı ilerleme akışına sızmaz"; else pass "upload komut çıktısı ilerleme akışına sızmaz"; fi

  reset_workflow
  export MOCK_METADATA_RESULT=failure
  expect_uploader_status "metadata hatası başarısız çıkar" 1
  if grep -q '^create:test-v1$' "$GH_LOG"; then pass "metadata hatasından önce taslak oluşturulur"; else fail "metadata hatasından önce taslak oluşturulur"; fi
  expect_log_absent "metadata hatasında publish çağrılmaz" '^publish:'
  if grep -q "SamulVanunu/cep-depo-apks" "$ZENITY_LOG" && grep -q "test-v1" "$ZENITY_LOG" && grep -qi "taslak" "$ZENITY_LOG"; then
    pass "metadata hatası korunan taslağın depo ve etiketini bildirir"
  else
    fail "metadata hatası korunan taslağın depo ve etiketini bildirir"
  fi

  reset_workflow
  export MOCK_REMOTE_RECORD=$(printf 'uploaded\t%s\tsha256:0000\tapplication/vnd.android.package-archive\t%s' "$size" "$good_url")
  expect_uploader_status "metadata digest uyuşmazlığı uploader içinde başarısız çıkar" 1
  if grep -q '^create:test-v1$' "$GH_LOG"; then pass "metadata uyuşmazlığından önce taslak oluşturulur"; else fail "metadata uyuşmazlığından önce taslak oluşturulur"; fi
  expect_log_absent "metadata uyuşmazlığında publish çağrılmaz" '^publish:'
  if grep -qi "SHA-256" "$ZENITY_LOG" && grep -q "SamulVanunu/cep-depo-apks" "$ZENITY_LOG" && grep -q "test-v1" "$ZENITY_LOG" && grep -qi "taslak" "$ZENITY_LOG"; then
    pass "metadata uyuşmazlığı korunan taslak UI bilgisini gösterir"
  else
    fail "metadata uyuşmazlığı korunan taslak UI bilgisini gösterir"
  fi

  reset_workflow
  export MOCK_CURL_RESULT=failure
  expect_uploader_status "yayın sonrası probe hatası başarısız çıkar" 1
  expected_order=$(printf 'publish:test-v1\nmetadata:test-v1\nprobe:%s' "$good_url")
  expect_equal "probe hatasında publish ve son metadata kontrolü probe öncesinde gerçekleşir" "$expected_order" "$(tail -n 3 "$WORKFLOW_LOG")"
  if grep -qi "yayımlandı" "$ZENITY_LOG" && grep -q "$good_url" "$ZENITY_LOG"; then
    pass "probe hatası yayımlanmış sürüm ve kurtarma URL durumunu doğru bildirir"
  else
    fail "probe hatası yayımlanmış sürüm ve kurtarma URL durumunu doğru bildirir"
  fi
  if grep -q 'RAW_CURL_COMMAND_OUTPUT' "$TMP/upload.err"; then fail "probe komut çıktısı ilerleme akışına sızmaz"; else pass "probe komut çıktısı ilerleme akışına sızmaz"; fi

  reset_workflow
  export MOCK_XCLIP_RESULT=failure
  expect_uploader_status "yayın sonrası xclip hatası başarı durumunu korur" 0
  if grep -q "$good_url" "$ZENITY_LOG" && grep -qi "elle" "$ZENITY_LOG"; then
    pass "xclip hatası URL'yi elle kopyalama için gösterir"
  else
    fail "xclip hatası URL'yi elle kopyalama için gösterir"
  fi

  echo "== Kullanıcı launcher kurulumu =="
  installer_home="$TMP/installer-home"
  installer_bundle="$TMP/installer bundle % & tools"
  rm -rf "$installer_home"
  mkdir -p "$installer_bundle"
  cp "$ROOT/apk-release-uploader/install.sh" "$ROOT/apk-release-uploader/upload.sh" \
    "$ROOT/apk-release-uploader/cep-depo-apk-uploader.desktop.template" "$installer_bundle/"
  HOME="$installer_home" bash "$installer_bundle/install.sh" >"$TMP/install.out" 2>"$TMP/install.err"
  if [ "$?" -eq 0 ]; then pass "installer geçici HOME altında çalışır"; else fail "installer geçici HOME altında çalışır"; fi
  launcher="$installer_home/.local/share/applications/cep-depo-apk-uploader.desktop"
  uploader_path="$installer_bundle/upload.sh"
  if [ -f "$launcher" ]; then pass "installer launcher oluşturur"; else fail "installer launcher oluşturur"; fi
  if [ -f "$launcher" ] && grep -Fxq "Terminal=false" "$launcher" && grep -Fxq "Exec=\"$TMP/installer bundle %% & tools/upload.sh\"" "$launcher"; then
    pass "launcher boşluk, yüzde ve ampersand içeren mutlak uploader yolunu tek Exec argümanı olarak korur"
  else
    fail "launcher boşluk, yüzde ve ampersand içeren mutlak uploader yolunu tek Exec argümanı olarak korur"
  fi
  if [ -f "$launcher" ] && ! grep -Eqi 'token|authorization|secret' "$launcher"; then pass "launcher token içermez"; else fail "launcher token içermez"; fi
  if [ -f "$launcher" ] && [ "$(stat -c %a "$launcher")" = "644" ]; then pass "launcher modu 0644 olur"; else fail "launcher modu 0644 olur"; fi
  launcher_first=$(cat "$launcher" 2>/dev/null)
  HOME="$installer_home" bash "$installer_bundle/install.sh" >"$TMP/install-second.out" 2>"$TMP/install-second.err"
  if [ "$?" -eq 0 ] && [ "$(find "$installer_home/.local/share/applications" -maxdepth 1 -name 'cep-depo-apk-uploader.desktop' | wc -l)" -eq 1 ] &&
    [ "$(cat "$launcher" 2>/dev/null)" = "$launcher_first" ]; then
    pass "installer ikinci çalıştırmada aynı tek launcher içeriğini korur"
  else
    fail "installer ikinci çalıştırmada aynı tek launcher içeriğini korur"
  fi
}

case "$GROUP" in
  validation) run_validation_tests;;
  github) run_github_tests;;
  workflow) run_workflow_tests;;
  all)
    run_validation_tests
    run_github_tests
    run_workflow_tests
    ;;
esac

echo
echo "Toplam: $((PASS + FAIL)), Geçen: $PASS, Başarısız: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
