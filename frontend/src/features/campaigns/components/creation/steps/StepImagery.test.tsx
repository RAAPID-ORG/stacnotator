import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CampaignCreate } from '~/api/client';
import { StepImagery, createInitialImageryState } from './StepImagery';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return {
    ...actual,
    getProjectOrganizationKeys: vi.fn(() =>
      Promise.resolve({ data: { items: [{ id: 7, name: 'Shared key' }] } })
    ),
    previewPlanetScenes: vi.fn(() => Promise.resolve({ data: [] })),
  };
});

import { previewPlanetScenes } from '~/api/client';

const form: CampaignCreate = {
  name: 'New campaign',
  project_id: 1,
  settings: {
    labels: [],
    bbox_west: 10,
    bbox_south: 20,
    bbox_east: 11,
    bbox_north: 21,
  },
};

describe('StepImagery', () => {
  it('bounds a Planet scene search by the area the wizard already has', async () => {
    const user = userEvent.setup();
    render(
      <StepImagery
        projectId={1}
        form={form}
        setForm={() => {}}
        imageryState={createInitialImageryState()}
        setImageryState={() => {}}
      />
    );

    await user.click(screen.getByText('Create source'));
    await user.click(screen.getByText('Planet Daily Imagery'));

    expect(screen.queryByText(/no area yet/)).toBeNull();

    await user.click(await screen.findByText('Connect to Planet'));
    await user.click(screen.getByText('Search'));

    expect(vi.mocked(previewPlanetScenes).mock.calls[0][0].body.config.aoi).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [10, 20],
          [11, 20],
          [11, 21],
          [10, 21],
          [10, 20],
        ],
      ],
    });
  });
});
