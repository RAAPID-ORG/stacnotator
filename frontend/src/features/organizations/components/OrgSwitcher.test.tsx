import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/api/client/sdk.gen', async () => {
  const actual =
    await vi.importActual<typeof import('~/api/client/sdk.gen')>('~/api/client/sdk.gen');
  return { ...actual, listOrganizations: vi.fn() };
});

import { listOrganizations } from '~/api/client/sdk.gen';
import { organizationPath } from '~/app/routes';
import { useAccountStore } from '~/shared/stores/account.store';
import { useOrgStore } from '~/shared/stores/org.store';
import { apiSuccess } from '~/shared/testing/apiSuccess';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';
import { OrgSwitcher } from './OrgSwitcher';

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

describe('OrgSwitcher', () => {
  it.each([
    { platformAdmin: false, orgAdmin: false, canManage: false },
    { platformAdmin: false, orgAdmin: true, canManage: true },
    { platformAdmin: true, orgAdmin: false, canManage: true },
  ])(
    'gates management for platform admin=$platformAdmin and organization admin=$orgAdmin',
    async ({ platformAdmin, orgAdmin, canManage }) => {
      const account = useAccountStore.getState().account!;
      useAccountStore.setState({ account: { ...account, is_admin: platformAdmin } });
      vi.mocked(listOrganizations).mockResolvedValue(
        apiSuccess({
          items: [
            {
              id: 7,
              name: 'Harvest',
              status: 'approved',
              allows_internal_storage: false,
              is_admin: orgAdmin,
            },
          ],
        })
      );
      const onNavigate = vi.fn();
      renderWithQuery(
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<OrgSwitcher onNavigate={onNavigate} />} />
            <Route path={organizationPath(7)} element={<div>Organization settings</div>} />
          </Routes>
        </MemoryRouter>
      );

      await screen.findByText('Harvest');
      const link = screen.queryByRole('link', { name: 'Manage organization' });
      if (!canManage) {
        expect(link).toBeNull();
        return;
      }
      expect(link?.getAttribute('href')).toBe(organizationPath(7));
      await userEvent.click(link!);
      expect(await screen.findByText('Organization settings')).toBeTruthy();
      expect(onNavigate).toHaveBeenCalledOnce();
    }
  );

  it('hides management when no organization is selected, even for a platform admin', async () => {
    const account = useAccountStore.getState().account!;
    useAccountStore.setState({ account: { ...account, is_admin: true } });
    useOrgStore.setState({ activeOrgId: null });
    vi.mocked(listOrganizations).mockResolvedValue(apiSuccess({ items: [] }));
    renderWithQuery(
      <MemoryRouter>
        <OrgSwitcher />
      </MemoryRouter>
    );

    await screen.findByRole('button', { name: 'Active organization' });
    expect(screen.queryByRole('link', { name: 'Manage organization' })).toBeNull();
  });
});
