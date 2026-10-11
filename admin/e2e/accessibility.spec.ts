import { expect, test } from '@playwright/test';

import { cleanupTestApp, cleanupTestUser, createTestApp, createTestUser, serviceClient } from './helpers';

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

test('dashboard provides landmarks, current navigation and visible keyboard focus', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Yönetim bölümleri' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('link', { name: /Özet.*aktif/ })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  await expect(focused).toHaveCSS('outline-style', 'solid');
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
