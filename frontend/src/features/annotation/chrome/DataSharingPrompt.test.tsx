import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { apiSuccess, makeCampaign } from '~/features/annotation/testing/fixtures';
import { seedCampaign } from '../testing/seed';
import { useCampaignStore } from '../stores/campaign';
import { DataSharingPrompt } from './DataSharingPrompt';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return { ...actual, setDataSharing: vi.fn() };
});

import { setDataSharing } from '~/api/client';

const seed = (viewer_data_sharing: 'none' | 'anonymous' | 'attributed' | null) =>
  seedCampaign(makeCampaign({ viewer_data_sharing, viewer_is_member: true }));

/** Nobody may label: the campaign has nothing to ask this viewer about. */
const seedReadOnly = () => {
  const base = makeCampaign({ viewer_data_sharing: null, viewer_is_member: false });
  const closed = { kinds: ['members' as const], user_ids: [] };
  seedCampaign({
    ...base,
    settings: {
      ...base.settings,
      labelling_policy: {
        explore: closed,
        assigned_tasks: closed,
        unassigned_tasks: closed,
        complete_assigned: closed,
      },
    },
  });
};

describe('DataSharingPrompt', () => {
  it('asks the annotator who has not been asked yet', () => {
    seed(null);
    render(<DataSharingPrompt paused={false} />);
    expect(screen.getByTestId('data-sharing-prompt')).toBeTruthy();
  });

  it('stays away once a choice is on record', () => {
    seed('none');
    render(<DataSharingPrompt paused={false} />);
    expect(screen.queryByTestId('data-sharing-prompt')).toBeNull();
  });

  it('waits for the tour to finish', () => {
    seed(null);
    render(<DataSharingPrompt paused />);
    expect(screen.queryByTestId('data-sharing-prompt')).toBeNull();
  });

  it('leaves alone a viewer who may not label here', () => {
    seedReadOnly();
    render(<DataSharingPrompt paused={false} />);
    expect(screen.queryByTestId('data-sharing-prompt')).toBeNull();
  });

  it('records the choice and closes for good', async () => {
    seed(null);
    vi.mocked(setDataSharing).mockResolvedValue(
      apiSuccess({ campaign_id: 7, campaign_name: 'Test campaign', choice: 'attributed' })
    );
    render(<DataSharingPrompt paused={false} />);

    await userEvent.click(screen.getByTestId('data-sharing-attributed'));

    expect(vi.mocked(setDataSharing).mock.calls[0][0]).toMatchObject({
      path: { campaign_id: 7 },
      body: { choice: 'attributed' },
    });
    expect(useCampaignStore.getState().campaign?.viewer_data_sharing).toBe('attributed');
    expect(screen.queryByTestId('data-sharing-prompt')).toBeNull();
  });
});
