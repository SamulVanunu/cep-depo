import { expect, test } from '@playwright/test';

let browserErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', error => browserErrors.push(error.message));
});
test.afterEach(() => expect(browserErrors).toEqual([]));

test('signed-out visitors are redirected to login', async ({ page }) => {
  await page.goto('/apps');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Yönetim paneli' })).toBeVisible();
});

test('non-admin credentials are denied without retaining a dashboard session', async ({ page }) => {
  const email = 'user-e2e@example.test';
  const password = 'E2e-safe-password-2026!';
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: process.env.E2E_SERVICE_ROLE_KEY!,
      authorization: `Bearer ${process.env.E2E_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username: 'user_e2e' } }),
  });
  expect(response.ok || response.status === 422).toBeTruthy();
  await page.goto('/login');
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Şifre').fill(password);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page.locator('#login-error')).toContainText('yetkin bulunmuyor');
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});
