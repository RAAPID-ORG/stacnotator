import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeCampaign } from '~/features/annotation/core/catalog/testHelpers';
import { getHelp } from '~/features/annotation/engine/hotkeys';
import { GuidePanel } from './GuidePanel';

const CAMPAIGN = makeCampaign({
  settings: {
    bbox_west: -10,
    bbox_south: -20,
    bbox_east: 10,
    bbox_north: 20,
    labels: [],
    labelling_policy: {
      explore: { kinds: ['anyone'] },
      assigned_tasks: { kinds: ['anyone'] },
      complete_assigned: { kinds: ['anyone'] },
      unassigned_tasks: { kinds: ['anyone'] },
    },
    guide_markdown: 'Label the fields.',
  },
});

describe('GuidePanel', () => {
  it('opens and closes the guide on G', async () => {
    const user = userEvent.setup();
    render(<GuidePanel campaign={CAMPAIGN} />);
    expect(screen.queryByTestId('guide-panel')).toBeNull();

    await user.keyboard('g');
    expect(screen.getByTestId('guide-panel')).toBeTruthy();
    expect(screen.getByText('Label the fields.')).toBeTruthy();

    await user.keyboard('g');
    expect(screen.queryByTestId('guide-panel')).toBeNull();
  });

  it('publishes the binding to the shared help table', () => {
    render(<GuidePanel campaign={CAMPAIGN} />);
    expect(getHelp().some((row) => row.scope === 'global' && row.key === 'g')).toBe(true);
  });
});
