import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlanetSceneBrowser } from './PlanetSceneBrowser';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return {
    ...actual,
    getProjectOrganizationKeys: vi.fn(() => Promise.resolve({ data: { items: [] } })),
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
});
