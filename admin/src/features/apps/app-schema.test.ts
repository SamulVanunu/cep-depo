import { describe, expect, it } from 'vitest';

import {
  appFormSchema,
  categoryFormSchema,
  parseAppFormData,
  parseQuickAppInput,
} from './app-schema';

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

  it('uses a null category when the full app form leaves category empty', () => {
    const data = validAppData();
    data.set('categoryId', '');

    expect(parseAppFormData(data).categoryId).toBeNull();
  });

  it('normalizes quick app input and ignores client-owned system fields', () => {
    expect(parseQuickAppInput({
      title: '  Çağrı Öz  ',
      shortDescription: 'Yeni uygulama için yeterli kısa açıklama.',
      categoryId: 'a1000000-0000-4000-8000-000000000001',
      featured: true,
      status: 'active',
    })).toEqual({
      title: 'Çağrı Öz',
      shortDescription: 'Yeni uygulama için yeterli kısa açıklama.',
      slug: 'cagri-oz',
    });
  });

  it('rejects quick app titles and descriptions outside database bounds', () => {
    expect(() => parseQuickAppInput({ title: 'x', shortDescription: 'Yeterince uzun' })).toThrow();
    expect(() => parseQuickAppInput({ title: 'Geçerli', shortDescription: 'kısa' })).toThrow();
    expect(() => parseQuickAppInput({ title: 'x'.repeat(91), shortDescription: 'Yeterince uzun' })).toThrow();
    expect(() => parseQuickAppInput({ title: 'Geçerli', shortDescription: 'x'.repeat(181) })).toThrow();
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
