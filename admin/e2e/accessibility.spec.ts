import { expect, test } from '@playwright/test';

import {
  addTestAppIcon,
  cleanupTestApp,
  cleanupTestUser,
  collectBrowserErrors,
  createTestApp,
  createTestUser,
  serviceClient,
} from './helpers';
import { manifestApk } from './fixtures/manifest-apk';

test.use({ storageState: 'e2e/.auth/admin.json' });

let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = collectBrowserErrors(page);
});
test.afterEach(() => expect(browserErrors).toEqual([]));

test('dashboard provides landmarks, current navigation and visible keyboard focus', async ({ page }) => {
  await page.goto('/publish');
  await expect(page.getByRole('navigation', { name: 'Yönetim bölümleri' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('link', { name: /APK Yükle.*aktif/ })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  await expect(focused).toHaveCSS('outline-style', 'solid');
});

test('publish wizard announces steps, focuses errors and supports keyboard publication', async ({ page }) => {
  const app = await createTestApp('e2e-a11y-publish');
  const packageName = `com.cepdepo.a11y${crypto.randomUUID().replaceAll('-', '')}`;
  const versionCode = 1_800_000 + Math.floor(Math.random() * 100_000);
  const apk = await manifestApk({ packageName, versionName: 'a11y-e2e', versionCode });
  try {
    await addTestAppIcon(app.id);
    await page.goto('/publish');
    const steps = page.getByRole('list', { name: 'Yayın adımları' });
    await expect(steps.locator('[aria-current="step"]')).toContainText('Uygulama');
    await page.getByRole('button', { name: 'APK adımına devam et' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Uygulama adı 2–90 karakter/)).toHaveAttribute('role', 'alert');
    await expect(page.getByLabel('Uygulama adı')).toBeFocused();

    await page.goto(`/publish?appId=${encodeURIComponent(app.id)}`);
    await expect(steps.locator('[aria-current="step"]')).toContainText('Uygulama');
    await page.getByRole('button', { name: 'APK adımına devam et' }).focus();
    await page.keyboard.press('Enter');
    await expect(steps.locator('[aria-current="step"]')).toContainText('APK');
    await expect(page.getByLabel('APK dosyası', { exact: true })).toBeVisible();
    await page.getByLabel('APK dosyası', { exact: true }).setInputFiles(apk);
    await expect(page.getByRole('region', { name: 'APK manifest özeti' })).toContainText(packageName);
    await page.getByRole('button', { name: "APK'yı yükle ve yayınla" }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Yayın tamamlandı' })).toBeVisible({ timeout: 20_000 });
  } finally {
    await cleanupTestApp(app.id);
  }
});

test('narrow publish layout keeps APK controls visible without page overflow', async ({ page }) => {
  const app = await createTestApp('e2e-narrow');
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/publish?appId=${encodeURIComponent(app.id)}`);
    await page.getByRole('button', { name: 'APK adımına devam et' }).click();
    await expect(page.getByLabel('APK dosyası', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: "APK'yı yükle ve yayınla" })).toBeVisible();
    const sizes = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(sizes.content).toBeLessThanOrEqual(sizes.viewport);
  } finally {
    await cleanupTestApp(app.id);
  }
});

test('forms and tables expose labels and headers', async ({ page }) => {
  await page.goto('/apps');
  await expect(page.getByRole('textbox', { name: 'Ara', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Uygulama' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Durum' })).toBeVisible();
});

test('login errors are announced and linked to both credentials', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-posta').fill('missing@example.test');
  await page.getByLabel('Şifre').fill('wrong-password');
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page.locator('#login-error')).toBeVisible();
  await expect(page.getByLabel('E-posta')).toHaveAttribute('aria-describedby', 'login-error');
  await expect(page.getByLabel('Şifre')).toHaveAttribute('aria-describedby', 'login-error');
});

test('destructive review confirmation cancels safely and restores trigger focus', async ({ page }) => {
  const [app, user] = await Promise.all([createTestApp('e2e-focus'), createTestUser('focus')]);
  const body = `E2E focus ${crypto.randomUUID()}`;
  const review = await serviceClient.from('reviews').insert({
    app_id: app.id,
    user_id: user.id,
    rating: 3,
    body,
    moderation_status: 'hidden',
  }).select('id').single();
  if (review.error) throw review.error;
  try {
    await page.goto(`/reviews?query=${encodeURIComponent(body)}`);
    const deleteButton = page.getByText(body).locator('..').getByRole('button', { name: 'Kalıcı sil' });
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('kalıcı olarak silinsin mi');
      await dialog.dismiss();
    });
    await deleteButton.click();
    await expect(deleteButton).toBeFocused();
    const persisted = await serviceClient.from('reviews').select('id').eq('id', review.data.id).maybeSingle();
    expect(persisted.data?.id).toBe(review.data.id);
  } finally {
    await cleanupTestUser(user.id);
    await cleanupTestApp(app.id);
  }
});
