import { expect, test as setup, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const adminFile = 'e2e/.auth/admin.json';
export const adminEmail = 'admin-e2e@example.test';
export const password = 'E2e-safe-password-2026!';

async function ensureUser(email: string, username: string, admin: boolean) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.E2E_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let user;
  for (let page = 1; page <= 10 && !user; page += 1) {
    const listed = await client.auth.admin.listUsers({ page, perPage: 100 });
    user = listed.data.users.find(candidate => candidate.email === email);
    if (listed.data.users.length < 100) break;
  }
  if (!user) {
    const created = await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } });
    if (created.error) throw created.error;
    user = created.data.user;
  }
  if (admin) await client.from('user_roles').upsert({ user_id: user.id, role: 'admin' });
}

async function login(page: Page, email: string, file: string) {
  await page.goto('/login');
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Şifre').fill(password);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page).toHaveURL('/');
  await page.context().storageState({ path: file });
}

setup('create authenticated states', async ({ page }) => {
  await ensureUser(adminEmail, 'admin_e2e', true);
  await login(page, adminEmail, adminFile);
});
