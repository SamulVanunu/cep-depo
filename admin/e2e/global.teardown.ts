import { createClient } from '@supabase/supabase-js';

export default async function teardown() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.E2E_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (let page = 1; page <= 10; page += 1) {
    const listed = await client.auth.admin.listUsers({ page, perPage: 100 });
    for (const user of listed.data.users) {
      if (user.email === 'admin-e2e@example.test' || user.email?.endsWith('-e2e@example.test')) {
        await client.auth.admin.deleteUser(user.id);
      }
    }
    if (listed.data.users.length < 100) break;
  }
  await client.from('apps').delete().like('slug', 'e2e-%');
}
