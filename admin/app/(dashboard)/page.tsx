import type { Metadata } from 'next';

import { getDashboardSummary } from '../../src/features/dashboard/dashboard-dal';
import { DashboardView } from '../../src/features/dashboard/dashboard-view';

export const metadata: Metadata = { title: 'Özet' };

export default async function DashboardPage() {
  const summary = await getDashboardSummary();
  return <DashboardView summary={summary} />;
}
