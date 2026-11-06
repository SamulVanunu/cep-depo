-- Generated JSON catalog artifacts (manifest.json, apps.json, categories.json).
-- Written only by the admin backend through the service_role client; clients get
-- read-only access. The bucket-level MIME and size limits are enforced by the
-- Storage API for every upload, including service_role calls.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'catalog',
    'catalog',
    true,
    2097152,
    array['application/json']
  )
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists catalog_public_read on storage.objects;

create policy catalog_public_read
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'catalog');
