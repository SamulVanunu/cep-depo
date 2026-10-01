import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

import type { Database } from '../types/database.types';
import { getPublicEnv } from './env';

let client: SupabaseClient<Database> | undefined;

export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client;

  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
  client = createClient<Database>(supabaseUrl, supabasePublishableKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

export function getPublicAssetUrl(path: string): string {
  return getSupabaseClient().storage.from('app-assets').getPublicUrl(path).data.publicUrl;
}

export function getPublicApkUrl(path: string): string {
  return getSupabaseClient().storage.from('apks').getPublicUrl(path).data.publicUrl;
}
