import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanetSceneBrowser } from './PlanetSceneBrowser';

const { orgKeys } = vi.hoisted(() => ({
  orgKeys: { items: [] as { id: number; name: string }[] },
}));

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return {
    ...actual,
    getProjectOrganizationKeys: vi.fn(() => Promise.resolve({ data: { items: orgKeys.items } })),
    planPlanetScenes: vi.fn(() =>
      Promise.resolve({
        data: [
          {
            start_date: '2024-01-01',
            end_date: '2024-01-31',
            cover: { start_date: '2024-01-01', end_date: '2024-01-31' },
            slices: [{ start_date: '2024-01-01', end_date: '2024-01-01' }],
          },
        ],
      })
    ),
  };
});

import { planPlanetScenes } from '~/api/client';

describe('PlanetSceneBrowser', () => {
  beforeEach(() => {
    orgKeys.items = [];
    // The plan mock is shared by the whole file, and these tests count its calls -
    // one test's calls must not answer the next one's wait.
    vi.mocked(planPlanetScenes).mockClear();
  });

  it('shows what will be created without being asked', async () => {
    render(<PlanetSceneBrowser projectId={1} onAdd={async () => {}} onClose={() => {}} />);

    await waitFor(() => expect(vi.mocked(planPlanetScenes)).toHaveBeenCalled());
    expect(await screen.findByText('What will be created')).toBeTruthy();
    expect(screen.getByText(/1 window, 2 slices/)).toBeTruthy();
  });

  it('follows the settings as they change', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<PlanetSceneBrowser projectId={1} onAdd={async () => {}} onClose={() => {}} />);

    await waitFor(() => expect(vi.mocked(planPlanetScenes)).toHaveBeenCalled());
    const calls = vi.mocked(planPlanetScenes).mock.calls.length;

    await user.selectOptions(screen.getByLabelText('New slice unit'), 'weeks');

    await waitFor(() =>
      expect(vi.mocked(planPlanetScenes).mock.calls.length).toBeGreaterThan(calls)
    );
    expect(vi.mocked(planPlanetScenes).mock.lastCall?.[0].body.config.slice_period_unit).toBe(
      'weeks'
    );
  });

  it('is ready to add with an organization key, without a connect step', async () => {
    orgKeys.items = [{ id: 7, name: 'Shared Planet key' }];
    render(<PlanetSceneBrowser projectId={1} onAdd={async () => {}} onClose={() => {}} />);

    const add = await screen.findByRole('button', { name: 'Add source' });
    await waitFor(() => expect(add.hasAttribute('disabled')).toBe(false));
  });
});
