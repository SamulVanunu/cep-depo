-- Run once in the existing Cep Depo Supabase project.
-- Keeps existing uploaded APK records and adds an HTTPS download link option.
alter table public.apps add column if not exists download_url text;
alter table public.apps alter column apk_path drop not null;
alter table public.apps drop constraint if exists apps_download_source_check;
alter table public.apps add constraint apps_download_source_check check (
  (apk_path is not null and download_url is null)
  or (apk_path is null and download_url is not null and download_url ~* '^https://[^[:space:]]+$')
);
