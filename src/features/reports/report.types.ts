import type { Database } from '../../types/database.types';

export type ReportReason = Database['public']['Enums']['report_reason'];

export type ReportTarget = Readonly<{
  appId: string;
  appTitle: string;
  versionId: string | null;
  versionName: string | null;
}>;

export type ReportDraft = Readonly<{
  reason: ReportReason;
  description: string;
}>;

export type Report = Readonly<{
  id: string;
  reporterId: string;
  appId: string;
  versionId: string | null;
  reason: ReportReason;
  description: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
}>;
