'use client';

import { createBrowserClient } from '@supabase/ssr';

import type { Database } from '../../types/database.types';
import { getPublicEnv } from '../env';

export function createBrowserSupabaseClient() {
  const env = getPublicEnv();
  return createBrowserClient<Database>(env.supabaseUrl, env.supabasePublishableKey);
}
