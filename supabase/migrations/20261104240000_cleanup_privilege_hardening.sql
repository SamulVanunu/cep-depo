-- Aşama 10A — tombstone integrity and legacy requeue hardening (F-01, F-02).
--
-- F-01: service_role could INSERT/UPDATE admin_asset_cleanup_jobs directly.
-- That bypassed every lifecycle invariant: a forged INSERT created a tombstone
-- that never went through enqueue validation, and a direct UPDATE could write
-- skipped_at/completed_at or lift a quarantine without a worker lease, a
-- reference seal or an audit row.
--
-- The queue table is now read-only for service_role. Every writer moves to
-- SECURITY DEFINER, owned by the migration role, with the empty search_path
-- that was already pinned on each function:
--
--   * lifecycle: claim, complete, fail, skip, enqueue_orphan
--   * admin requeue: admin_requeue_cleanup_job
--   * the two admin flows that enqueue tombstones in the same transaction as
--     their own writes: admin_publish_version_replacing_previous and
--     admin_delete_app_permanently
--
-- cleanup_asset_is_referenced stays SECURITY INVOKER: it only reads and the
-- service_role still has SELECT on the tables it probes.
--
-- F-02: the legacy cleanup_requeue_job() has no actor, reference or audit
-- checks and no production caller (only the pgTAP suite). It loses its
-- service_role EXECUTE grant but remains available to the migration role for
-- tests and controlled maintenance. The only app-facing way to lift a
-- quarantine is now admin_requeue_cleanup_job(), which requires an admin actor,
-- re-checks the reference seal and writes the cleanup.requeue audit row.
--
-- private.cleanup_purge_job is deliberately untouched: it stays DEFINER,
-- postgres-owned and unreachable from every app role. Its transaction-local
-- purge permit is not used as an authorization boundary anywhere else.

-- ---------------------------------------------------------------------------
-- Lifecycle and enqueue writers: run as the migration role
-- ---------------------------------------------------------------------------

alter function public.cleanup_claim_jobs(text, integer, integer)
  security definer;
alter function public.cleanup_complete_job(uuid, text)
  security definer;
alter function public.cleanup_fail_job(uuid, text, text)
  security definer;
alter function public.cleanup_skip_job(uuid, text, text)
  security definer;
alter function public.cleanup_enqueue_orphan(text, text, text)
  security definer;

alter function public.admin_requeue_cleanup_job(uuid, uuid, timestamptz, text)
  security definer;
alter function public.admin_publish_version_replacing_previous(uuid, uuid)
  security definer;
alter function public.admin_delete_app_permanently(uuid, uuid, text)
  security definer;

-- ---------------------------------------------------------------------------
-- The queue table is read-only for the application role
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate
  on table public.admin_asset_cleanup_jobs
  from public, anon, authenticated, service_role;

grant select on table public.admin_asset_cleanup_jobs to service_role;

-- ---------------------------------------------------------------------------
-- Legacy requeue: keep the function, remove the app role
-- ---------------------------------------------------------------------------

revoke execute on function public.cleanup_requeue_job(uuid, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Re-assert the supported RPC surface (idempotent)
-- ---------------------------------------------------------------------------

revoke all on function public.cleanup_claim_jobs(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_claim_jobs(text, integer, integer)
  to service_role;

revoke all on function public.cleanup_asset_is_referenced(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_asset_is_referenced(text, text)
  to service_role;

revoke all on function public.cleanup_complete_job(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_complete_job(uuid, text)
  to service_role;

revoke all on function public.cleanup_fail_job(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_fail_job(uuid, text, text)
  to service_role;

revoke all on function public.cleanup_skip_job(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_skip_job(uuid, text, text)
  to service_role;

revoke all on function public.cleanup_enqueue_orphan(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_enqueue_orphan(text, text, text)
  to service_role;

revoke all on function public.admin_requeue_cleanup_job(uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_requeue_cleanup_job(uuid, uuid, timestamptz, text)
  to service_role;

revoke all on function public.admin_publish_version_replacing_previous(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_publish_version_replacing_previous(uuid, uuid)
  to service_role;

revoke all on function public.admin_delete_app_permanently(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_app_permanently(uuid, uuid, text)
  to service_role;
