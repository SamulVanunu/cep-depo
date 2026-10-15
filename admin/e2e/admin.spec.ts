import { expect, test } from '@playwright/test';

import {
  cleanupTestApp,
  cleanupTestUser,
  createTestApp,
  createTestUser,
  collectBrowserErrors,
  serviceClient,
  uniqueValue,
} from './helpers';

test.use({ storageState: 'e2e/.auth/admin.json' });

let browserErrors: string[] = [];
const onePixelPng = {
  name: 'pixel.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
};
test.beforeEach(async ({ page }) => {
  browserErrors = collectBrowserErrors(page);
});
test.afterEach(() => expect(browserErrors).toEqual([]));

test('admin can navigate all operations queues and logout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Özet' })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Yönetim bölümleri' });
  for (const [name, heading] of [
    ['APK Yükle', 'Uygulama yayınla'],
    ['Uygulamalar', 'Uygulamalar'],
    ['Yorumlar', 'Yorumlar'],
    ['Şikâyetler', 'Şikâyetler'],
    ['Kullanıcılar', 'Kullanıcılar'],
    ['Ayarlar', 'Ayarlar'],
  ] as const) {
    await navigation.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Çıkış yap' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('admin creates and explicitly publishes a new app in the default category', async ({ page }) => {
  const title = `E2E ${uniqueValue('publish')}`;
  let appId: string | undefined;
  try {
    await page.goto('/publish');
    await page.getByRole('button', { name: 'Yeni uygulama oluştur' }).click();
    await page.getByLabel('Uygulama adı').fill(title);
    await page.getByLabel('Kısa açıklama').fill('E2E yeni uygulama yayınlama akışı açıklaması.');
    await page.getByRole('button', { name: 'Uygulamayı oluştur' }).click();
    await expect(page.getByRole('heading', { name: 'APK bilgileri' })).toBeFocused();
    const created = await serviceClient.from('apps').select('id, slug').eq('title', title).single();
    expect(created.error).toBeNull();
    appId = created.data?.id;
    const versionCode = 1_000_000 + Math.floor(Math.random() * 500_000);
    await page.getByLabel('APK dosyası', { exact: true }).setInputFiles('e2e/fixtures/test.apk');
    await page.getByLabel('Sürüm adı').fill('1.0-e2e');
    await page.getByLabel('Sürüm kodu').fill(String(versionCode));
    await page.getByLabel('Değişiklik notları').fill('Yeni uygulama E2E yayını.');
    await page.getByRole('button', { name: 'APK dosyasını doğrula' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Kontrol ve yayın' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/SHA-256 doğrulamasını göster/)).toBeVisible();
    await page.getByRole('button', { name: 'Yayınla' }).click();
    await expect(page.getByRole('heading', { name: 'Yayın tamamlandı' })).toBeVisible();

    await expect.poll(async () => {
      const state = await serviceClient
        .from('apps')
        .select('status, categories(slug), app_versions(id, status, version_code)')
        .eq('id', appId!)
        .single();
      const version = state.data?.app_versions.find(item => item.version_code === versionCode);
      return { app: state.data?.status, category: state.data?.categories?.slug, version: version?.status };
    }).toEqual({ app: 'active', category: 'genel', version: 'published' });

    const versions = await serviceClient.from('app_versions').select('id').eq('app_id', appId!);
    expect(versions.data).toHaveLength(1);
    const audits = await serviceClient
      .from('admin_audit_logs')
      .select('action, target_id')
      .in('target_id', [appId!, versions.data![0]!.id]);
    expect(audits.data?.filter(row => row.action === 'app.create')).toHaveLength(1);
    expect(audits.data?.filter(row => row.action === 'version.draft')).toHaveLength(1);
    expect(audits.data?.filter(row => row.action === 'version.publish')).toHaveLength(1);
    expect(audits.data?.filter(row => row.action === 'app.activate')).toHaveLength(1);
  } finally {
    const existing = appId
      ? { data: { id: appId } }
      : await serviceClient.from('apps').select('id').eq('title', title).maybeSingle();
    if (existing.data) await cleanupTestApp(existing.data.id);
  }
});

test('admin retries validation and publishes to an existing app without duplication', async ({ page }) => {
  const app = await createTestApp('e2e-upload');
  try {
    const versionCode = 1_500_000 + Math.floor(Math.random() * 500_000);
    await page.goto(`/publish?appId=${encodeURIComponent(app.id)}`);
    await page.getByRole('button', { name: 'APK adımına devam et' }).click();
    await page.getByLabel('Sürüm adı').fill('9.9-e2e');
    await page.getByLabel('Sürüm kodu').fill(String(versionCode));
    await page.getByRole('button', { name: 'APK dosyasını doğrula' }).click();
    await expect(page.locator('#apk-step-error')).toContainText('APK');
    await page.getByLabel('APK dosyası', { exact: true }).setInputFiles('e2e/fixtures/test.apk');
    await page.getByLabel('Değişiklik notları').fill('E2E upload doğrulaması.');
    await page.getByRole('button', { name: 'Tekrar dene' }).click();
    await expect(page.getByRole('heading', { name: 'Kontrol ve yayın' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Yayınla' }).click();
    await expect.poll(async () => {
      const [versions, apps] = await Promise.all([
        serviceClient.from('app_versions').select('status').eq('app_id', app.id).eq('version_code', versionCode),
        serviceClient.from('apps').select('id').eq('slug', app.slug),
      ]);
      return { appCount: apps.data?.length, versionCount: versions.data?.length, status: versions.data?.[0]?.status };
    }).toEqual({ appCount: 1, versionCount: 1, status: 'published' });
  } finally {
    await cleanupTestApp(app.id);
  }
});

test('admin sees visual uploads without reloading the app detail page', async ({ page }) => {
  const app = await createTestApp('e2e-visual');
  try {
    await page.goto(`/apps/${app.id}`);
    await page.getByLabel('Uygulama ikonu').setInputFiles(onePixelPng);
    await expect(page.getByRole('img', { name: 'Mevcut uygulama ikonu' })).toBeVisible();

    await page.getByLabel('Ekran görüntüsü').setInputFiles({ ...onePixelPng, name: 'screenshot.png' });
    await page.getByLabel('Erişilebilir alt metin').fill('E2E görsel önizlemesi');
    await page.getByRole('button', { name: 'Ekran görüntüsü ekle' }).click();
    await expect(page.getByRole('img', { name: 'E2E görsel önizlemesi' })).toBeVisible();
    expect(await page.getByRole('img').count()).toBeGreaterThanOrEqual(2);
  } finally {
    await cleanupTestApp(app.id);
  }
});

test('admin publishes an external APK and activates an archived app without APK Storage', async ({ page }) => {
  const app = await createTestApp('e2e-external');
  const versionCode = 2_000_000 + Math.floor(Math.random() * 500_000);
  try {
    await page.goto(`/apps/${app.id}`);
    await page.getByRole('button', { name: 'Arşivlemeyi onayla' }).click();
    await expect.poll(async () => (
      await serviceClient.from('apps').select('status').eq('id', app.id).single()
    ).data?.status).toBe('archived');

    await page.goto(`/publish?appId=${encodeURIComponent(app.id)}`);
    await page.getByRole('button', { name: 'APK adımına devam et' }).click();
    await page.getByRole('radio', { name: 'HTTPS APK linki kullan' }).check();
    await page.getByLabel('Doğrulanacak yerel APK dosyası').setInputFiles('e2e/fixtures/test.apk');
    await page.getByLabel('Doğrudan HTTPS APK bağlantısı').fill(
      'https://downloads.example.com/releases/test.apk',
    );
    await page.getByLabel('Sürüm adı').fill('3.1-e2e');
    await page.getByLabel('Sürüm kodu').fill(String(versionCode));
    await page.getByLabel('Değişiklik notları').fill('Harici APK E2E yayını.');
    await page.getByRole('button', { name: 'Harici APK bilgilerini doğrula' }).click();
    await expect(page.getByRole('heading', { name: 'Kontrol ve yayın' })).toBeVisible();
    await expect(page.getByText('downloads.example.com')).toBeVisible();
    await page.getByRole('button', { name: 'Yayınla' }).click();
    await expect(page.getByRole('heading', { name: 'Yayın tamamlandı' })).toBeVisible();

    await expect.poll(async () => {
      const state = await serviceClient
        .from('apps')
        .select('status, app_versions(id, status, version_code, download_source, apk_path)')
        .eq('id', app.id)
        .single();
      const version = state.data?.app_versions.find(item => item.version_code === versionCode);
      return {
        app: state.data?.status,
        version: version?.status,
        source: version?.download_source,
        path: version?.apk_path,
      };
    }).toEqual({ app: 'active', version: 'published', source: 'external', path: null });

    const objects = await serviceClient.storage.from('apks').list(`apps/${app.id}/versions`);
    expect(objects.error).toBeNull();
    expect(objects.data ?? []).toHaveLength(0);
  } finally {
    await cleanupTestApp(app.id);
  }
});

test('admin hides and restores a review', async ({ page }) => {
  const [app, user] = await Promise.all([createTestApp('e2e-review'), createTestUser('reviewer')]);
  const body = `E2E review ${crypto.randomUUID()}`;
  const inserted = await serviceClient.from('reviews').insert({ app_id: app.id, user_id: user.id, rating: 4, body }).select('id').single();
  if (inserted.error) throw inserted.error;
  try {
    await page.goto(`/reviews?query=${encodeURIComponent(body)}`);
    const card = page.getByText(body).locator('..');
    await card.getByRole('button', { name: 'Gizle' }).click();
    await expect(page.getByText('Yorum durumu güncellendi.')).toBeVisible();
    await expect.poll(async () => (await serviceClient.from('reviews').select('moderation_status').eq('id', inserted.data.id).single()).data?.moderation_status).toBe('hidden');
    await page.reload();
    await page.getByText(body).locator('..').getByRole('button', { name: 'Göster' }).click();
    await expect.poll(async () => (await serviceClient.from('reviews').select('moderation_status').eq('id', inserted.data.id).single()).data?.moderation_status).toBe('visible');
  } finally {
    await cleanupTestUser(user.id);
    await cleanupTestApp(app.id);
  }
});

test('admin resolves and dismisses reports with notes', async ({ page }) => {
  const [app, user] = await Promise.all([createTestApp('e2e-report'), createTestUser('reporter')]);
  try {
    for (const [status, label] of [['resolved', 'Çözüldü'], ['dismissed', 'Reddedildi']] as const) {
      const report = await serviceClient.from('reports').insert({
        app_id: app.id,
        reporter_id: user.id,
        reason: 'diger',
        description: `E2E ${status} report`,
      }).select('id').single();
      if (report.error) throw report.error;
      await page.goto(`/reports/${report.data.id}`);
      await page.getByLabel('Sonuç').selectOption(status);
      await page.getByLabel('Yönetici notu').fill(`E2E ${label} notu`);
      await page.getByRole('button', { name: 'Şikâyeti kapat' }).click();
      await expect(page.getByText('Bu şikâyet kapatılmıştır; yeniden açma desteklenmez.')).toBeVisible();
      await expect.poll(async () => (await serviceClient.from('reports').select('status').eq('id', report.data.id).single()).data?.status).toBe(status);
    }
  } finally {
    await cleanupTestUser(user.id);
    await cleanupTestApp(app.id);
  }
});

test('user lifecycle enforces suspension and exact-name deletion barriers', async ({ page }) => {
  const user = await createTestUser('managed');
  try {
    await page.goto(`/users/${user.id}`);
    await expect(page.getByRole('button', { name: 'Kullanıcıyı kalıcı sil' })).toBeDisabled();
    await page.getByRole('button', { name: 'Askıya al' }).click();
    await expect(page.getByText('Hesap durumu güncellendi.')).toBeVisible();
    await expect.poll(async () => (await serviceClient.from('profiles').select('status').eq('user_id', user.id).single()).data?.status).toBe('suspended');
    await page.reload();
    await page.getByRole('button', { name: 'Etkinleştir' }).click();
    await expect.poll(async () => (await serviceClient.from('profiles').select('status').eq('user_id', user.id).single()).data?.status).toBe('active');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Kullanıcıyı kalıcı sil' })).toBeDisabled();
    await page.getByRole('button', { name: 'Askıya al' }).click();
    await expect.poll(async () => (await serviceClient.from('profiles').select('status').eq('user_id', user.id).single()).data?.status).toBe('suspended');
    await page.reload();
    await page.getByLabel(new RegExp(user.username)).fill('yanlis_kullanici');
    await page.getByRole('button', { name: 'Kullanıcıyı kalıcı sil' }).click();
    await expect(page.getByText('Gönderilen bilgiler geçerli değil.')).toBeVisible();
    await page.getByLabel(new RegExp(user.username)).fill(user.username);
    await page.getByRole('button', { name: 'Kullanıcıyı kalıcı sil' }).click();
    await expect(page).toHaveURL(/\/users$/);
    await expect.poll(async () => (await serviceClient.auth.admin.getUserById(user.id)).data.user).toBeNull();
  } finally {
    await cleanupTestUser(user.id);
  }
});

test('admin accounts expose no suspend or delete controls', async ({ page }) => {
  const listed = await serviceClient.auth.admin.listUsers({ page: 1, perPage: 100 });
  const current = listed.data.users.find(user => user.email === 'admin-e2e@example.test');
  expect(current).toBeTruthy();
  await page.goto(`/users/${current!.id}`);
  await expect(page.getByText('Yönetici hesaplarında askıya alma ve silme kapalıdır.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Askıya al' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Kullanıcıyı kalıcı sil' })).toHaveCount(0);
});
