import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppList } from './app-list';

describe('AppList', () => {
  it('shows only app, latest version, status, and management action', () => {
    const result = {
      items: [{
        id: 'a1000000-0000-4000-8000-000000000001',
        title: 'Cep Araç',
        slug: 'cep-arac',
        status: 'active' as const,
        latestVersion: { versionName: '2.1.0', versionCode: 12 },
      }],
      count: 1,
      page: 1,
      pageSize: 20,
    };
    render(<AppList result={result} />);
    expect(screen.getAllByRole('columnheader').map(header => header.textContent?.trim())).toEqual([
      'Uygulama',
      'Son sürüm',
      'Durum',
      'İşlem',
    ]);
    expect(screen.getByText('2.1.0')).toBeVisible();
    expect(screen.getByText('Kod 12')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Yönet' })).toHaveAttribute(
      'href',
      '/apps/a1000000-0000-4000-8000-000000000001',
    );
  });

  it('renders a clear empty state', () => {
    render(<AppList result={{ items: [], count: 0, page: 1, pageSize: 20 }} />);
    expect(screen.getByText('Filtrelerle eşleşen uygulama yok.')).toBeVisible();
  });
});
