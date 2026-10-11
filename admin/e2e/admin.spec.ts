import { expect, test } from '@playwright/test';

import {
  cleanupTestApp,
  cleanupTestUser,
  createTestApp,
  createTestUser,
  serviceClient,
  uniqueValue,
} from './helpers';

test.use({ storageState: 'e2e/.auth/admin.json' });

let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', error => browserErrors.push(error.message));
});
test.afterEach(() => expect(browserErrors).toEqual([]));

test('admin can navigate all operations queues and logout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Özet' })).toBeVisible();
  for (const name of ['Uygulamalar', 'Yorumlar', 'Şikâyetler', 'Kullanıcılar']) {
    await page.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Çıkış yap' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('admin creates a catalog record without server-owned counters', async ({ page }) => {
  const slug = uniqueValue('e2e-created');
  let appId: string | undefined;
  try {
    await page.goto('/apps/new');
    await expect(page.getByRole('heading', { name: 'Yeni uygulama' })).toBeVisible();
    await expect(page.getByLabel('İndirme')).toHaveCount(0);
    await page.getByLabel('Kategori').selectOption({ index: 1 });
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Başlık').fill(`E2E ${slug}`);
    await page.getByLabel('Kısa açıklama').fill('E2E oluşturma akışı için kısa açıklama.');
    await page.getByLabel('Açıklama', { exact: true }).fill('E2E oluşturma akışı için yeterince uzun uygulama açıklaması.');
    await page.getByRole('button', { name: 'Uygulama oluştur' }).click();
    await expect(page.getByRole('status')).toContainText('başarıyla');
    const created = await serviceClient.from('apps').select('id').eq('slug', slug).single();
    expect(created.error).toBeNull();
    appId = created.data?.id;
  } finally {
    const existing = appId
      ? { data: { id: appId } }
      : await serviceClient.from('apps').select('id').eq('slug', slug).maybeSingle();
    if (existing.data) await cleanupTestApp(existing.data.id);
  }
});

test('admin uploads, finalizes and publishes a small APK draft', async ({ page }) => {
  const app = await createTestApp('e2e-upload');
  try {
    await page.goto(`/apps/${app.id}/versions/new`);
    await page.getByLabel('APK dosyası').setInputFiles('e2e/fixtures/test.apk');
    await page.getByLabel('Sürüm adı').fill('9.9-e2e');
    await page.getByLabel('Sürüm kodu').fill('999');
    await page.getByLabel('Değişiklik notları').fill('E2E upload doğrulaması.');
    await page.getByRole('button', { name: 'Upload başlat' }).click();
    await expect(page.getByText(/İlerleme: %/)).toBeVisible();
    await expect(page.getByText(/Taslak sürüm hazır:/)).toBeVisible({ timeout: 20_000 });

    await page.goto(`/apps/${app.id}`);
    const draft = page.getByText(/9\.9-e2e · Kod 999 · draft/);
    await expect(draft).toBeVisible();
    await draft.locator('..').getByRole('button', { name: 'Yayımla' }).click();
    await expect(page.getByText('Sürüm durumu güncellendi.')).toBeVisible();
    await expect.poll(async () => {
      const version = await serviceClient.from('app_versions').select('status').eq('app_id', app.id).eq('version_code', 999).single();
      return version.data?.status;
    }).toBe('published');
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
