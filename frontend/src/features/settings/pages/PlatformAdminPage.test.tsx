import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';

vi.mock('~/shared/stores/account.store', () => ({
  useAccountStore: (selector: (state: object) => unknown) =>
    selector({
      account: {
        id: 'admin',
        display_name: 'Admin',
        email: 'admin@example.test',
        is_platform_admin: true,
      },
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
import { PlatformAdminPage } from './PlatformAdminPage';

beforeEach(() => vi.clearAllMocks());

it('separates platform organizations and users into tabs, loading only the active management data', async () => {
  renderWithQuery(
    <MemoryRouter>
      <PlatformAdminPage />
    </MemoryRouter>
  );
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

it('shows platform admins and regular users returned by the users endpoint', async () => {
  vi.mocked(listUsers).mockResolvedValueOnce({
    error: undefined,
    data: [
      {
        id: 'admin',
        email: 'admin@example.test',
        display_name: 'Admin',
        is_platform_admin: true,
        issuer: 'local',
        external_uid: 'admin',
      },
      {
        id: 'user',
        email: 'user@example.test',
        display_name: 'Regular User',
        is_platform_admin: false,
        issuer: 'local',
        external_uid: 'user',
      },
    ],
  });

  renderWithQuery(
    <MemoryRouter>
      <PlatformAdminPage />
    </MemoryRouter>
  );
  await userEvent.click(screen.getByRole('tab', { name: 'Users' }));

  const adminEmail = await screen.findByText('admin@example.test');
  const userEmail = screen.getByText('user@example.test');
  expect(adminEmail.closest('tr')?.querySelector('[data-user-role="admin"]')).toBeTruthy();
  expect(userEmail.closest('tr')?.querySelector('[data-user-role="user"]')).toBeTruthy();
  expect(screen.queryByText('No users found')).toBeNull();
});
