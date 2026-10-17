import { createClient } from '@supabase/supabase-js';

export default async function teardown() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.E2E_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const e2eUserIds: string[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const listed = await client.auth.admin.listUsers({ page, perPage: 100 });
    for (const user of listed.data.users) {
      if (user.email === 'admin-e2e@example.test' || user.email?.endsWith('-e2e@example.test')) {
        e2eUserIds.push(user.id);
      }
    }
    if (listed.data.users.length < 100) break;
  }
  await client.from('apps').delete().like('slug', 'e2e-%');
  if (e2eUserIds.length) {
    const audits = await client
      .from('admin_audit_logs')
      .select('target_id')
      .in('actor_id', e2eUserIds)
      .eq('action', 'asset.cleanup_pending');
    const operationIds = (audits.data ?? []).map(row => row.target_id);
    if (operationIds.length) {
      await client.from('admin_asset_cleanup_jobs').delete().in('operation_id', operationIds);
    }
    for (const userId of e2eUserIds) await client.auth.admin.deleteUser(userId);
  }
}
