import { z } from 'zod';

export function normalizeUserSearch(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 320 || !/^[\p{L}\p{N}@.+\-\s]+$/u.test(normalized)) return undefined;
  return normalized;
}

export const userIdSchema = z.string().uuid();

export const deleteUserSchema = z.object({
  userId: userIdSchema,
  confirmation: z.string().trim().min(1).max(100),
});
