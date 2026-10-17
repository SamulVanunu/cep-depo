import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppForm } from './app-form';

vi.mock('./app-actions', () => ({
  createAppAction: vi.fn(),
  updateAppAction: vi.fn(),
}));

const category = {
  id: 'a3000000-0000-4000-8000-000000000001',
  name: 'Araçlar',
  slug: 'araclar',
  position: 0,
  isActive: true,
  isDefault: false,
};

describe('AppForm', () => {
  it('edits app metadata without exposing a publication status field', () => {
    render(<AppForm categories={[category]} app={{
      id: 'a2000000-0000-4000-8000-000000000001',
      category_id: category.id,
      slug: 'ornek',
      title: 'Örnek',
      short_description: 'Yeterince uzun açıklama',
      description: 'Yeterince uzun uygulama açıklaması',
      featured: false,
      status: 'active',
    }} />);

    expect(screen.getByLabelText('Başlık')).toHaveValue('Örnek');
    expect(screen.queryByLabelText('Durum')).not.toBeInTheDocument();
  });
});
