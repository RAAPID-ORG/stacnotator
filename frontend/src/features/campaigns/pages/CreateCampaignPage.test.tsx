import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';
import { DEFAULT_LABELLING_POLICY, withAnyoneSeeded } from '../utils/labellingPolicy';

vi.mock('~/api/client/sdk.gen', async () => ({
  ...(await vi.importActual<typeof import('~/api/client/sdk.gen')>('~/api/client/sdk.gen')),
  getProject: vi.fn(),
  getProjectUsers: vi.fn(() => Promise.resolve({ data: { users: [] } })),
  createCampaign: vi.fn(() =>
    Promise.resolve({ data: { id: 7, project_id: 3, registration_status: 'ready' } })
  ),
}));
vi.mock('../components/creation/steps/StepCampaign', () => ({ StepCampaign: () => null }));
vi.mock('../components/creation/steps/StepSettings', () => ({ StepSettings: () => null }));
vi.mock('../components/creation/steps/StepImagery', () => ({
  StepImagery: () => null,
  createInitialImageryState: () => ({}),
}));
vi.mock('../components/creation/steps/StepAddTimeseries', () => ({
  StepAddTimeseries: () => null,
}));
vi.mock('../utils/campaignValidation', () => ({
  validateFullForm: () => ({
    isValid: true,
    campaign: { errors: {} },
    settings: { errors: {} },
    imagery: { errors: {} },
    timeseries: { errors: {} },
  }),
}));

import { createCampaign, getProject } from '~/api/client/sdk.gen';
import { CreateCampaignPage } from './CreateCampaignPage';

const openCreateStep = async (visibility: 'private' | 'public') => {
  vi.mocked(getProject).mockResolvedValue({
    data: { id: 3, name: 'Test project', is_admin: true, visibility },
  } as Awaited<ReturnType<typeof getProject>>);
  renderWithQuery(
    <MemoryRouter initialEntries={['/projects/3/new']}>
      <Routes>
        <Route path="/projects/:projectId/new" element={<CreateCampaignPage />} />
        <Route path="*" element={<div>Created campaign</div>} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole('button', { name: 'Continue' });
  for (let i = 0; i < 4; i++) {
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }
};

describe('Campaign creation access options', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['private', 'public'] as const)(
    'keeps access collapsed and submits the default policy for a %s project',
    async (visibility) => {
      await openCreateStep(visibility);
      expect(screen.queryByText('Labelling access')).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Advanced options' }).getAttribute('aria-expanded')
      ).toBe('false');
      expect(screen.queryByRole('button', { name: /Access/ })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
      await waitFor(() => expect(createCampaign).toHaveBeenCalled());
      expect(vi.mocked(createCampaign).mock.calls[0][0]?.body?.labelling_policy).toEqual(
        visibility === 'public'
          ? withAnyoneSeeded(DEFAULT_LABELLING_POLICY)
          : DEFAULT_LABELLING_POLICY
      );
    }
  );

  it('preserves changed permissions when advanced options are collapsed', async () => {
    await openCreateStep('private');
    await userEvent.click(screen.getByRole('button', { name: 'Advanced options' }));
    const editingRule = screen
      .getByText('Editing and deleting other people’s annotations')
      .closest('li');
    expect(editingRule).not.toBeNull();
    await userEvent.click(within(editingRule!).getByRole('checkbox', { name: 'Members' }));
    await userEvent.click(screen.getByRole('button', { name: 'Advanced options' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(createCampaign).toHaveBeenCalled());
    expect(
      vi.mocked(createCampaign).mock.calls[0][0]?.body?.labelling_policy?.modify_others
    ).toEqual({
      kinds: ['admins', 'members'],
      user_ids: [],
    });
  });
});
