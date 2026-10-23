import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/api/client/sdk.gen', async () => {
  const actual =
    await vi.importActual<typeof import('~/api/client/sdk.gen')>('~/api/client/sdk.gen');
  return { ...actual, listOrganizations: vi.fn() };
});
vi.mock('~/app/providers/AuthProvider', () => ({
  useAuth: () => ({ auth: { logout: vi.fn() } }),
}));

import { listOrganizations } from '~/api/client/sdk.gen';
import { organizationPath } from '~/app/routes';
import { useAccountStore } from '~/shared/stores/account.store';
import { useOrgStore } from '~/shared/stores/org.store';
import { apiSuccess } from '~/shared/testing/apiSuccess';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';
import { AccountMenu } from './AccountMenu';

const harvest = (isAdmin: boolean) =>
  apiSuccess({
    items: [
      {
        id: 7,
        name: 'Harvest',
        status: 'approved',
        allows_internal_storage: false,
        is_admin: isAdmin,
      },
    ],
  });

beforeEach(() => {
  useAccountStore.setState({
    account: {
      id: 'u-1',
      email: 'ada@example.org',
      is_admin: false,
      issuer: 'local',
      external_uid: 'u-1',
      terms_version: '1',
    },
  });
  useOrgStore.setState({ activeOrgId: 7, hasChosenOrg: true });
  vi.mocked(listOrganizations).mockReset();
});

describe('AccountMenu', () => {
  it.each([
    { platformAdmin: false, orgAdmin: false, canManage: false },
    { platformAdmin: false, orgAdmin: true, canManage: true },
    { platformAdmin: true, orgAdmin: false, canManage: true },
  ])(
    'offers organization settings for platform admin=$platformAdmin and organization admin=$orgAdmin',
    async ({ platformAdmin, orgAdmin, canManage }) => {
      const account = useAccountStore.getState().account!;
      useAccountStore.setState({ account: { ...account, is_admin: platformAdmin } });
      vi.mocked(listOrganizations).mockResolvedValue(harvest(orgAdmin));
      const onNavigate = vi.fn();
      renderWithQuery(
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<AccountMenu collapsed={false} onNavigate={onNavigate} />} />
            <Route path={organizationPath(7)} element={<div>Organization page</div>} />
          </Routes>
        </MemoryRouter>
      );

      await screen.findByText('Harvest');
      await userEvent.click(screen.getByTestId('account-menu'));
      const settings = screen.queryByRole('menuitem', { name: 'Organization settings' });
      if (!canManage) {
        expect(settings).toBeNull();
        return;
      }
      await userEvent.click(settings!);
      expect(await screen.findByText('Organization page')).toBeTruthy();
      expect(onNavigate).toHaveBeenCalledOnce();
    }
  );

  it('offers no organization settings when no organization is selected, even to a platform admin', async () => {
    const account = useAccountStore.getState().account!;
    useAccountStore.setState({ account: { ...account, is_admin: true } });
    useOrgStore.setState({ activeOrgId: null });
    vi.mocked(listOrganizations).mockResolvedValue(apiSuccess({ items: [] }));
    renderWithQuery(
      <MemoryRouter>
        <AccountMenu collapsed={false} />
      </MemoryRouter>
    );

    await screen.findByText('No organization');
    await userEvent.click(screen.getByTestId('account-menu'));
    expect(screen.queryByRole('menuitem', { name: 'Organization settings' })).toBeNull();
    expect(screen.getByRole('menuitemradio', { name: 'No organization' })).toBeTruthy();
  });
});
