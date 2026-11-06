-- B2 sealed publish payload reader (A10.36 S7).
--
-- S4 deliberately shipped no RPC that returns payload bytes. Nothing needed
-- them yet, and every extra reader is extra surface. S7 is where one is
-- actually needed: a producer retry after a lost HTTP response must reuse the
-- bytes the first run sealed instead of rebuilding them from a catalog that may
-- have moved on. Rebuilding is not merely wasteful — it would produce a payload
-- the seal no longer describes, which is exactly the false idempotency S6.1
-- closed on the commit side.
--
-- This is the narrowest reader that supports that, and no more:
--
--   * keyed on the operation id, gated on the attempt id. A different attempt
--     of the same operation cannot read the first attempt's bytes.
--   * only a sealed intent has a payload. in_progress never had one, and a
--     committed or failed intent had it dropped by S3's transition trigger;
--     both are refused with CDP10 rather than answered with "no rows", because
--     an empty result would let a caller mistake absence for a match.
--   * the stored text and digest are returned verbatim. Nothing here parses,
--     normalises or re-serialises the payload: the digest describes bytes the
--     producer already hashed, and any rewrite would break that claim.
--   * SECURITY INVOKER, service_role only, and marked STABLE so the planner can
--     treat it as a read. It writes nothing.
--
-- SQLSTATE contract (messages are operator hints only):
--
--   CDP09 intent_not_found        no intent for the operation id
--   CDP10 intent_state_conflict   the intent is not sealed
--   CDI03 lease_attempt_mismatch  the attempt is not the one that sealed it
--   22004 null_value_not_allowed  a required parameter is null
--   42501 insufficient_privilege  anon/authenticated call
--
-- Out of scope, by instruction: the producer (admin/src/features/catalog),
-- Storage, the consumer, the UI, the feature flag, hosted databases and
-- deployment.

create function public.get_catalog_publish_intent_payload(
  p_operation_id uuid,
  p_attempt_id uuid
)
returns table (
  payload text,
  payload_digest text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_intent public.catalog_publish_intents%rowtype;
begin
  if p_operation_id is null or p_attempt_id is null then
    raise exception using errcode = '22004',
      message = 'İşlem ve deneme kimliği zorunlu.';
  end if;

  select *
  into v_intent
  from public.catalog_publish_intents as i
  where i.operation_id = p_operation_id;

  if not found then
    raise exception using errcode = 'CDP09',
      message = 'Yayın niyeti bulunamadı.';
  end if;

  -- The attempt is the witness that this caller is the one that sealed these
  -- bytes. Without it the operation id alone would be enough to read a payload
  -- belonging to a different attempt.
  if v_intent.attempt_id is distinct from p_attempt_id then
    raise exception using errcode = 'CDI03',
      message = 'Deneme kimliği yayın niyetiyle uyuşmuyor.';
  end if;

  if v_intent.status <> 'sealed' then
    raise exception using errcode = 'CDP10',
      message = 'Yayın yükü yalnızca mühürlü niyet için okunabilir.';
  end if;

  return query
    select p.payload, p.payload_digest
    from public.catalog_publish_intent_payloads as p
    where p.operation_id = p_operation_id
      and p.payload_digest = v_intent.payload_digest;
end;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Revoke that first, then
-- grant the one role that drives publication.
revoke all on function public.get_catalog_publish_intent_payload(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.get_catalog_publish_intent_payload(
  uuid, uuid
) to service_role;
