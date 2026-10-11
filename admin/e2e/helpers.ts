import { createClient } from '@supabase/supabase-js';

export const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.E2E_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export function uniqueValue(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function createTestUser(prefix = 'member') {
  const username = uniqueValue(prefix).replaceAll('-', '_');
  const email = `${uniqueValue(prefix)}-e2e@example.test`;
  const result = await serviceClient.auth.admin.createUser({
    email,
    password: 'E2e-safe-password-2026!',
    email_confirm: true,
    user_metadata: { username },
  });
  if (result.error || !result.data.user) throw result.error ?? new Error('Test user could not be created.');
  return { id: result.data.user.id, email, username };
}

export async function createTestApp(prefix = 'e2e-app') {
  const category = await serviceClient.from('categories').select('id').order('position').limit(1).single();
  if (category.error) throw category.error;
  const slug = uniqueValue(prefix);
  const result = await serviceClient.from('apps').insert({
    category_id: category.data.id,
    slug,
    title: `E2E ${slug}`,
    short_description: 'E2E tarayıcı testi için uygulama kaydı.',
    description: 'E2E tarayıcı testi tarafından oluşturulan ve test sonunda silinen uygulama kaydı.',
  }).select('id, slug, title').single();
  if (result.error) throw result.error;
  return result.data;
}

export async function cleanupTestApp(appId: string) {
  const versions = await serviceClient.from('app_versions').select('id, apk_path').eq('app_id', appId);
  const versionIds = (versions.data ?? []).map(version => version.id);
  if (versionIds.length) {
    const audits = await serviceClient.from('admin_audit_logs').select('metadata').in('target_id', versionIds).eq('action', 'version.draft');
    const draftPaths = (audits.data ?? []).flatMap(row => {
      const metadata = row.metadata;
      return metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof metadata.path === 'string'
        ? [metadata.path]
        : [];
    });
    if (draftPaths.length) await serviceClient.storage.from('apk-drafts').remove(draftPaths);
    const apkPaths = (versions.data ?? []).map(version => version.apk_path);
    if (apkPaths.length) await serviceClient.storage.from('apks').remove(apkPaths);
  }
  await serviceClient.from('apps').delete().eq('id', appId);
}

export async function cleanupTestUser(userId: string) {
  await serviceClient.auth.admin.deleteUser(userId);
}
