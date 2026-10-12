import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { listApps, listCategories, listOrphanUploads } = vi.hoisted(() => ({
  listApps: vi.fn(),
  listCategories: vi.fn(),
  listOrphanUploads: vi.fn(),
}));

vi.mock('./app-dal', () => ({ listApps, listCategories }));
vi.mock('../uploads/upload-dal', () => ({ listOrphanUploads }));

import AppsPage from '../../../app/(dashboard)/apps/page';
import SettingsPage from '../../../app/(dashboard)/settings/page';
import { CategoryManager } from './category-manager';

const categories = [
  { id: 'a1000000-0000-4000-8000-000000000001', name: 'Genel', slug: 'genel', position: 0, isActive: true, isDefault: true },
  { id: 'a1000000-0000-4000-8000-000000000002', name: 'Araçlar', slug: 'araclar', position: 10, isActive: true, isDefault: false },
] as const;

describe('category settings', () => {
  it('marks and protects the default category while leaving others editable', () => {
    render(<CategoryManager categories={categories} />);
    const defaultForm = screen.getByDisplayValue('Genel').closest('form');
    const otherForm = screen.getByDisplayValue('Araçlar').closest('form');
    expect(defaultForm).not.toBeNull();
    expect(otherForm).not.toBeNull();
    expect(within(defaultForm!).getByText('Varsayılan')).toBeVisible();
    expect(within(defaultForm!).getByRole('checkbox', { name: 'Aktif' })).toBeDisabled();
    expect(within(otherForm!).getByRole('checkbox', { name: 'Aktif' })).toBeEnabled();
  });

  it('moves category and orphan management from apps to settings', async () => {
    listApps.mockResolvedValue({ items: [], count: 0, page: 1, pageSize: 20 });
    listCategories.mockResolvedValue(categories);
    listOrphanUploads.mockResolvedValue([]);
    const appsPage = render(await AppsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole('heading', { name: 'Kategoriler' })).not.toBeInTheDocument();
    appsPage.unmount();

    render(await SettingsPage());
    expect(screen.getByRole('heading', { name: 'Kategoriler' })).toBeVisible();
  });
});
