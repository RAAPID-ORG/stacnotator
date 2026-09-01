import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CampaignCreate } from '~/api/client';
import { StepImagery, createInitialImageryState } from './StepImagery';

vi.mock('../../imagery/controller', async () => {
  const actual = await vi.importActual<typeof import('../../imagery/controller')>(
    '../../imagery/controller'
  );
  return { ...actual, useDraftController: vi.fn(actual.useDraftController) };
});

import { useDraftController } from '../../imagery/controller';

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
  it('hands the area picked one step earlier to the imagery controller', () => {
    // Catalog searches are bounded by it, and the wizard used to leave it null - which
    // compiles, renders, and quietly searches the whole world.
    render(
      <StepImagery
        projectId={1}
        form={form}
        setForm={() => {}}
        imageryState={createInitialImageryState()}
        setImageryState={() => {}}
      />
    );

    expect(vi.mocked(useDraftController).mock.calls[0][0].campaignBbox).toEqual([10, 20, 11, 21]);
  });
});
