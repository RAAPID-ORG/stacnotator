import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';

vi.mock('~/app/providers/AuthProvider', () => ({
  useAuth: () => ({ auth: { logout: vi.fn() } }),
}));
vi.mock('~/shared/stores/account.store', () => ({
  useAccountStore: (selector: (state: object) => unknown) =>
    selector({
      account: { id: 'admin', display_name: 'Admin', email: 'admin@example.test', is_admin: true },
      fetchAccount: vi.fn(),
    }),
}));
vi.mock('~/api/client/sdk.gen', async () => ({
  ...(await vi.importActual<typeof import('~/api/client/sdk.gen')>('~/api/client/sdk.gen')),
  listOrganizations: vi.fn(() => Promise.resolve({ data: { items: [] } })),
  listUsers: vi.fn(() => Promise.resolve({ data: [] })),
  listGrantableTilers: vi.fn(() => Promise.resolve({ data: [] })),
}));

import { listGrantableTilers, listUsers } from '~/api/client/sdk.gen';
import { SettingsPage } from './SettingsPage';

beforeEach(() => vi.clearAllMocks());

it('separates platform organizations and users into tabs, loading only the active management data', async () => {
  renderWithQuery(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
  await userEvent.click(screen.getByRole('button', { name: 'Platform' }));
  await waitFor(() => expect(listGrantableTilers).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('tab', { name: 'Organizations' }).getAttribute('aria-selected')).toBe(
    'true'
  );
  expect(screen.queryByText(/Platform users/)).toBeNull();
  expect(listUsers).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('tab', { name: 'Users' }));
  await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('tab', { name: 'Users' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText(/Platform users/)).toBeTruthy();
  expect(document.getElementById('tab-organizations')).toBeNull();
});
