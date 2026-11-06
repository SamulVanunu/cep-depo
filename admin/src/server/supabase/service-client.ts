import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getServerEnv } from '../../lib/env';
import type { Database } from '../../types/database.types';
import { RPC_TIMEOUT_MS, STORAGE_CALL_TIMEOUT_MS } from '../../features/uploads/cleanup-config';

const directFetch = globalThis.fetch.bind(globalThis);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

// Every request this client makes is bounded: RPCs are short, Storage calls
// delete a single object. A hung socket must not outlive the job budget.
const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = requestUrl(input).includes('/rest/v1/rpc/')
    ? RPC_TIMEOUT_MS
    : STORAGE_CALL_TIMEOUT_MS;

  const signals: AbortSignal[] = [AbortSignal.timeout(timeout)];
  if (init?.signal) signals.push(init.signal);

  return directFetch(input, { ...init, signal: AbortSignal.any(signals) });
};

/**
 * Service-role client for background work. It is never used for admin actions
 * (those go through getAdminClient with an authenticated identity), so a
 * missing actor cannot silently borrow service_role.
 */
export function getServiceClient(): SupabaseClient<Database> {
  const env = getServerEnv();

  return createClient<Database>(env.supabaseUrl, env.supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: fetchWithTimeout,
    },
  });
}
