import { z } from 'zod';

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ş', 's')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const slugSchema = z.string().transform(normalizeSlug).pipe(
  z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
);

export const appFormSchema = z.object({
  categoryId: z.preprocess(
    value => value === '' ? null : value,
    z.string().uuid().nullable(),
  ),
  slug: slugSchema,
  title: z.string().trim().min(2).max(90),
  shortDescription: z.string().trim().min(10).max(180),
  description: z.string().trim().min(10).max(5000),
  featured: z.boolean(),
  status: z.enum(['active', 'archived']),
});

export const quickAppSchema = z.object({
  title: z.string().trim().min(2).max(90),
  shortDescription: z.string().trim().min(10).max(180),
}).transform(input => ({
  ...input,
  slug: slugSchema.parse(input.title),
}));

export const categoryFormSchema = z.object({
  name: z.string().trim().min(2).max(90),
  slug: slugSchema,
  position: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean(),
});

export const screenshotSchema = z.object({
  appId: z.string().uuid(),
  path: z.string().min(1).max(500).refine(path => !/(^|\/)\.\.(\/|$)/.test(path)),
  altText: z.string().trim().min(2).max(180),
  position: z.number().int().min(0),
});

function checkbox(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true' || value === '1';
}

export function parseAppFormData(formData: FormData) {
  return appFormSchema.parse({
    categoryId: formData.get('categoryId'),
    slug: formData.get('slug'),
    title: formData.get('title'),
    shortDescription: formData.get('shortDescription'),
    description: formData.get('description'),
    featured: checkbox(formData.get('featured')),
    status: formData.get('status'),
  });
}

export function parseQuickAppInput(raw: unknown) {
  return quickAppSchema.parse(raw);
}

export function parseCategoryFormData(formData: FormData) {
  return categoryFormSchema.parse({
    name: formData.get('name'),
    slug: formData.get('slug'),
    position: Number(formData.get('position')),
    isActive: checkbox(formData.get('isActive')),
  });
}
