import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../auth/auth-context';
import { getSupabaseClient } from '../../lib/supabase';
import { createReportRepository } from './report.repository';
import type { ReportDraft, ReportTarget } from './report.types';

export const reportKeys = {
  all: ['reports'] as const,
  open: (target: ReportTarget, reporterId: string) =>
    [...reportKeys.all, 'open', reporterId, target.appId, target.versionId ?? 'app'] as const,
};

function repository() {
  return createReportRepository(getSupabaseClient());
}

export function useOpenReport(target: ReportTarget) {
  const auth = useAuth();
  const reporterId = auth.status === 'signedIn' ? auth.user?.id : undefined;
  const query = useQuery({
    queryKey: reportKeys.open(target, reporterId ?? ''),
    queryFn: () => repository().getOpen(target, reporterId!),
    enabled: Boolean(reporterId),
  });
  return { ...query, alreadyOpen: Boolean(query.data) };
}

export function useSubmitReport(target: ReportTarget) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const reporterId = auth.status === 'signedIn' ? auth.user?.id : undefined;
  return useMutation({
    mutationFn: (draft: ReportDraft) => {
      if (!reporterId) throw new Error('Şikâyet göndermek için giriş yapmalısın.');
      return repository().submitReport(target, reporterId, draft);
    },
    onSuccess: report => {
      queryClient.setQueryData(reportKeys.open(target, reporterId ?? ''), report);
    },
  });
}
