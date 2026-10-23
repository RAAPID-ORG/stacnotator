import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeCampaign, makeSettings } from '~/features/annotation/testing/fixtures';
import { helpRows } from '../../hotkeys';
import { GuidePanel } from './GuidePanel';

const CAMPAIGN = makeCampaign({
  settings: makeSettings({ guide_markdown: 'Label the fields.' }),
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
    await waitFor(() => expect(screen.queryByTestId('guide-panel')).toBeNull());
  });

  it('publishes the binding to the shared help table', () => {
    render(<GuidePanel campaign={CAMPAIGN} />);
    expect(helpRows().some((row) => row.key === 'G')).toBe(true);
  });
});
