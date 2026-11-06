-- P0-2: remove the legacy publication entry points.
--
-- `admin_publish_version_and_activate_app` wrapped `admin_publish_version`,
-- and neither enforced the replacement rules: app package identity, monotonic
-- version code, the first-publish icon, the canonical Storage path, or old
-- version replacement/cleanup. `admin_publish_version_replacing_previous` is
-- now the only function that may move a version to `published`.
--
-- Drop the dependent function first. Both are `security invoker` and were
-- granted only to `service_role`; dropping the functions removes the grants.

drop function public.admin_publish_version_and_activate_app(uuid, uuid);

drop function public.admin_publish_version(uuid, uuid);
