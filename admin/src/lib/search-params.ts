import { z } from 'zod';

export type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

export type ListParams = Readonly<{
  page: number;
  pageSize: number;
  query?: string;
  sort: 'updated_at' | 'title' | 'created_at';
  direction: 'asc' | 'desc';
  status?: 'active' | 'archived';
  categoryId?: string;
}>;

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseListParams(input: RawSearchParams): ListParams {
  const rawQuery = scalar(input.query)?.trim();
  const query =
    rawQuery &&
    rawQuery.length <= 200 &&
    /^[\p{L}\p{N}\s.-]+$/u.test(rawQuery) &&
    !rawQuery.includes('%') &&
    !rawQuery.includes('_')
      ? rawQuery
      : undefined;
  const rawSort = scalar(input.sort);
  const rawDirection = scalar(input.direction);
  const rawStatus = scalar(input.status);
  const rawCategoryId = scalar(input.categoryId);
  const categoryId = z.string().uuid().safeParse(rawCategoryId);

  return {
    page: positiveInteger(scalar(input.page), 1),
    pageSize: Math.min(positiveInteger(scalar(input.pageSize), 25), 100),
    ...(query ? { query } : {}),
    sort:
      rawSort === 'title' || rawSort === 'created_at' || rawSort === 'updated_at'
        ? rawSort
        : 'updated_at',
    direction: rawDirection === 'asc' ? 'asc' : 'desc',
    ...(rawStatus === 'active' || rawStatus === 'archived' ? { status: rawStatus } : {}),
    ...(categoryId.success ? { categoryId: categoryId.data } : {}),
  };
}
