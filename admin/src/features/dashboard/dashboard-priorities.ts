export type DashboardPriority = Readonly<{
  id: string;
  kind: 'report' | 'operation';
  title: string;
  detail: string;
  href: string;
  createdAt: string;
}>;

type OpenReport = Readonly<{
  id: string;
  reason: string;
  description: string | null;
  created_at: string;
  apps: Readonly<{ title: string }> | null;
}>;

type IncompleteOperation = Readonly<{
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  created_at: string;
}>;

export function mergeDashboardPriorities(
  reports: readonly OpenReport[],
  operations: readonly IncompleteOperation[],
): readonly DashboardPriority[] {
  const reportPriorities = reports.map(report => ({
    id: report.id,
    kind: 'report' as const,
    title: report.apps?.title ?? 'Bilinmeyen uygulama',
    detail: report.description?.trim() || report.reason.replaceAll('_', ' '),
    href: `/reports/${report.id}`,
    createdAt: report.created_at,
  }));
  const operationPriorities = operations.map(operation => ({
    id: operation.id,
    kind: 'operation' as const,
    title: 'Tamamlanmamış yayın işlemi',
    detail: operation.action.replaceAll('.', ' · '),
    href:
      operation.target_type === 'app'
        ? `/apps/${encodeURIComponent(operation.target_id)}`
        : '/apps?operation=incomplete',
    createdAt: operation.created_at,
  }));

  return [...reportPriorities, ...operationPriorities]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, 10);
}
