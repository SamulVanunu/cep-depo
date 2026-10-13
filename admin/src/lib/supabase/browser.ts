'use client';

import { createBrowserClient } from '@supabase/ssr';

import type { Database } from '../../types/database.types';
import { getPublicEnv } from '../env';

export function createBrowserSupabaseClient() {
  const env = getPublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return createBrowserClient<Database>(env.supabaseUrl, env.supabasePublishableKey);
}
