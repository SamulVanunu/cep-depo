import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { getServerEnv } from '../../lib/env';
import type { Database } from '../../types/database.types';
import { type AdminIdentity, isAdminIdentity } from '../auth/require-admin';
import { ActionException } from '../errors/action-error';

export function getAdminClient(identity: AdminIdentity) {
  if (!isAdminIdentity(identity)) throw new ActionException('FORBIDDEN');

  const env = getServerEnv();
  return createClient<Database>(env.supabaseUrl, env.supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
