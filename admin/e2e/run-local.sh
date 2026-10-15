#!/usr/bin/env bash
set -euo pipefail
umask 077

ENV_FILE="${TMPDIR:-/tmp}/cep-depo-supabase-env"
trap 'rm -f "$ENV_FILE"' EXIT
npx supabase status -o env > "$ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:56321"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
export NEXT_PUBLIC_SITE_URL="http://127.0.0.1:3000"
export SUPABASE_SECRET_KEY="$SERVICE_ROLE_KEY"
export E2E_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export ADMIN_READ_ONLY="false"
export AUTH_EMAIL_ENABLED="false"
export EXTERNAL_APK_PUBLISHING_ENABLED="true"

psql "$DB_URL" -v ON_ERROR_STOP=1 \
  -c "update auth.users set confirmation_token = coalesce(confirmation_token, ''), recovery_token = coalesce(recovery_token, ''), email_change_token_new = coalesce(email_change_token_new, ''), email_change = coalesce(email_change, ''), phone_change = coalesce(phone_change, ''), phone_change_token = coalesce(phone_change_token, ''), email_change_token_current = coalesce(email_change_token_current, ''), reauthentication_token = coalesce(reauthentication_token, '')" \
  >/dev/null
psql "$DB_URL" -v ON_ERROR_STOP=1 \
  -c "delete from auth.users where email = 'admin-e2e@example.test' or email like '%-e2e@example.test'" \
  >/dev/null
psql "$DB_URL" -v ON_ERROR_STOP=1 \
  -c "delete from public.apps where slug::text like 'e2e-%'" \
  >/dev/null

npx playwright test "$@"
