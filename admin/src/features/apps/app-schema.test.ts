import { describe, expect, it } from 'vitest';

import { appFormSchema, categoryFormSchema, parseAppFormData } from './app-schema';

function validAppData(): FormData {
  const data = new FormData();
  data.set('categoryId', 'a1000000-0000-4000-8000-000000000001');
  data.set('slug', '  Güvenli Uygulama  ');
  data.set('title', 'Güvenli Uygulama');
  data.set('shortDescription', 'Güvenli kısa uygulama açıklaması');
  data.set('description', 'Güvenli ve yeterince uzun uygulama açıklaması.');
  data.set('featured', 'on');
  data.set('status', 'active');
  return data;
}

describe('catalog schemas', () => {
  it('normalizes a valid slug and enforces the database text bounds', () => {
    expect(parseAppFormData(validAppData()).slug).toBe('guvenli-uygulama');
    expect(() => appFormSchema.parse({
      categoryId: 'a1000000-0000-4000-8000-000000000001',
      slug: 'valid',
      title: 'x',
      shortDescription: 'too short',
      description: 'too short',
      featured: false,
      status: 'active',
    })).toThrow();
  });

  it('never accepts download_count or server-owned fields from form data', () => {
    const data = validAppData();
    data.set('download_count', '999999');
    data.set('created_at', '1990-01-01');
    data.set('icon_path', '../../secret');

    expect(parseAppFormData(data)).not.toHaveProperty('download_count');
    expect(parseAppFormData(data)).not.toHaveProperty('created_at');
    expect(parseAppFormData(data)).not.toHaveProperty('icon_path');
  });

  it('validates category name, slug, position and active state', () => {
    expect(categoryFormSchema.parse({
      name: 'Üretkenlik',
      slug: 'uretkenlik',
      position: 0,
      isActive: true,
    })).toEqual({
      name: 'Üretkenlik',
      slug: 'uretkenlik',
      position: 0,
      isActive: true,
    });
    expect(() => categoryFormSchema.parse({
      name: '', slug: 'Bad Slug', position: -1, isActive: true,
    })).toThrow();
  });
});
