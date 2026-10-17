import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

import type { Database } from '../src/types/database.types';
import { onePixelPng } from './fixtures/manifest-apk';

export const serviceClient = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.E2E_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export function uniqueValue(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  return errors;
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
  const category = await serviceClient.from('categories').select('id').eq('is_default', true).single();
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

export async function addTestAppIcon(appId: string) {
  const path = `apps/${appId}/icons/${crypto.randomUUID()}.png`;
  const uploaded = await serviceClient.storage.from('app-assets').upload(path, onePixelPng.buffer, {
    contentType: onePixelPng.mimeType,
  });
  if (uploaded.error) throw uploaded.error;
  const updated = await serviceClient.from('apps').update({ icon_path: path }).eq('id', appId);
  if (updated.error) throw updated.error;
  return path;
}

export async function createPublishedTestApp({
  prefix = 'e2e-published',
  packageName,
  versionCode,
}: Readonly<{
  prefix?: string;
  packageName: string;
  versionCode: number;
}>) {
  const app = await createTestApp(prefix);
  await addTestAppIcon(app.id);
  const appUpdate = await serviceClient
    .from('apps')
    .update({ package_name: packageName, status: 'active' })
    .eq('id', app.id);
  if (appUpdate.error) throw appUpdate.error;
  const version = await serviceClient.from('app_versions').insert({
    app_id: app.id,
    package_name: packageName,
    version_name: `e2e-${versionCode}`,
    version_code: versionCode,
    download_source: 'external',
    apk_url: `https://downloads.example.com/releases/${app.slug}-${versionCode}.apk`,
    apk_size_bytes: 1024,
    sha256: 'a'.repeat(64),
    status: 'published',
    published_at: new Date().toISOString(),
  }).select('id').single();
  if (version.error) throw version.error;
  return { ...app, packageName, versionId: version.data.id, versionCode };
}

export async function cleanupTestApp(appId: string) {
  const app = await serviceClient
    .from('apps')
    .select('icon_path, app_screenshots(id, path)')
    .eq('id', appId)
    .maybeSingle();
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
    const apkPaths = (versions.data ?? []).flatMap(version =>
      version.apk_path ? [version.apk_path] : [],
    );
    if (apkPaths.length) await serviceClient.storage.from('apks').remove(apkPaths);
    await serviceClient.from('admin_audit_logs').delete().in('target_id', [...versionIds, ...draftPaths, ...apkPaths]);
  }
  await serviceClient.from('apps').delete().eq('id', appId);
  const assetPaths = [
    ...(app.data?.icon_path ? [app.data.icon_path] : []),
    ...(app.data?.app_screenshots ?? []).map(screenshot => screenshot.path),
  ];
  if (assetPaths.length) await serviceClient.storage.from('app-assets').remove(assetPaths);
  const screenshotIds = (app.data?.app_screenshots ?? []).map(screenshot => screenshot.id);
  if (screenshotIds.length || assetPaths.length) {
    await serviceClient
      .from('admin_audit_logs')
      .delete()
      .in('target_id', [...screenshotIds, ...assetPaths]);
  }
  await serviceClient.from('admin_audit_logs').delete().eq('target_id', appId);
}

export async function cleanupTestUser(userId: string) {
  await serviceClient.auth.admin.deleteUser(userId);
}
