import { z } from 'zod';

export const closeReportSchema = z.object({
  reportId: z.string().uuid(),
  status: z.enum(['resolved', 'dismissed']),
  adminNote: z.string().trim().min(1).max(2000),
});
