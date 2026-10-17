import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PublishWizard } from './publish-wizard';

describe('PublishWizard', () => {
  it('renders the application step', () => {
    render(
      <PublishWizard
        categories={[{ id: 'a3000000-0000-4000-8000-000000000001', name: 'Araçlar' }]}
        initialApp={null}
        initialSelectionInvalid={false}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Uygulama bilgileri' })).toBeVisible();
  });
});
