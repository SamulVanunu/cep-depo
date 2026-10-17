import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listPublishApps, listCategories, redirect } = vi.hoisted(() => ({
  listPublishApps: vi.fn(),
  listCategories: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../apps/app-dal', () => ({ listPublishApps, listCategories }));
vi.mock('next/navigation', () => ({ redirect }));

import PublishPage from '../../../app/(dashboard)/publish/page';
import NewVersionPage from '../../../app/(dashboard)/apps/[appId]/versions/new/page';

describe('publish routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPublishApps.mockResolvedValue([]);
    listCategories.mockResolvedValue([]);
  });

  it('renders a recoverable warning for an invalid app query', async () => {
    render(await PublishPage({ searchParams: Promise.resolve({ appId: 'missing' }) }));
    expect(screen.getByRole('status')).toHaveTextContent('Uygulama seçimi bulunamadı');
  });

  it('redirects the old version route to the encoded publish query', async () => {
    const appId = 'a1000000-0000-4000-8000-000000000001';
    await NewVersionPage({ params: Promise.resolve({ appId }) });
    expect(redirect).toHaveBeenCalledWith(`/publish?appId=${encodeURIComponent(appId)}`);
  });
});
