import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
export const configured = !!url && !!key;
export const db = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder', {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
export type AppRecord = {
  id: string; title: string; description: string; category: string; version: string;
  icon_url: string | null; apk_path: string | null; download_url: string | null; requires_external_account: boolean;
  account_url: string | null; created_at: string;
};
export type Review = { id: string; body: string; rating: number; created_at: string; author_id: string };
export function publicApkUrl(path: string) {
  return db.storage.from('apks').getPublicUrl(path).data.publicUrl;
}
