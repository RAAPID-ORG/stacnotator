import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignOutFull } from '~/api/client';
import type { FormField } from '../../campaign/annotation';
import { apiSuccess, makeAnnotation, makeCampaign } from '~/features/annotation/testing/fixtures';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useCampaignStore } from '../../stores/campaign';
import { useWorkStore } from '../../stores/work';
import { seedCampaign } from '../../testing/seed';
import { ModeSwitch } from './ModeSwitch';

const alerts: string[] = [];
beforeEach(() => {
  alerts.length = 0;
  useLayoutStore.setState({ showAlert: (message) => alerts.push(message) });
});

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return { ...actual, createAnnotationOpenmode: vi.fn() };
});

import { createAnnotationOpenmode } from '~/api/client';

const NOTES: FormField = { id: 1, title: 'Notes', type: 'text', required: true };
const GEOMETRY: GeoJSON.Geometry = { type: 'Point', coordinates: [1, 2] };

const POLICY = {
  userId: 'u1',
  isAdmin: false,
  isAuthoritative: false,
  isMember: true,
  isAssigned: false,
};

function campaignWithFields(): CampaignOutFull {
  const base = makeCampaign();
  return { ...base, settings: { ...base.settings, form_fields: [NOTES] } };
}

/** The store reads the campaign's fields, so the draft is opened against the
 *  seeded campaign rather than being handed them. */
async function openDraft(campaign: CampaignOutFull): Promise<void> {
  seedCampaign(campaign, { mode: 'explore' });
  useWorkStore.getState().beginDraft(1);
  await useWorkStore.getState().drawEnd(GEOMETRY);
}

afterEach(() => {
  vi.mocked(createAnnotationOpenmode).mockReset();
  useWorkStore.getState().resetAll();
  useCampaignStore.getState().setWorkMode('explore');
});

function renderSwitch(campaign: CampaignOutFull) {
  return render(<ModeSwitch campaign={campaign} hasTasks policy={POLICY} />);
}

/** The click starts an async close and the mode change lands after it, so
 *  every assertion here waits for that continuation first. */
async function clickTasks(): Promise<void> {
  await userEvent.click(screen.getByText('Tasks'));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('leaving Explore with a draft open', () => {
  it('discards an unanswered draft before the mode changes', async () => {
    const campaign = campaignWithFields();
    await openDraft(campaign);
    renderSwitch(campaign);

    await clickTasks();

    // Nothing may still be open: in Tasks the same store fields collect the
    // task's answers, which would land on this shape.
    expect(useWorkStore.getState().draft.phase).toBe('idle');
    expect(createAnnotationOpenmode).not.toHaveBeenCalled();
    expect(useCampaignStore.getState().workMode).toBe('tasks');
  });

  it('saves an answered draft before the mode changes', async () => {
    const campaign = campaignWithFields();
    await openDraft(campaign);
    useWorkStore.getState().setFormValues({ '1': 'a note' });
    vi.mocked(createAnnotationOpenmode).mockResolvedValue(apiSuccess(makeAnnotation({ id: 5 })));
    renderSwitch(campaign);

    await clickTasks();

    expect(createAnnotationOpenmode).toHaveBeenCalledTimes(1);
    expect(useWorkStore.getState().draft.phase).toBe('idle');
    expect(useCampaignStore.getState().workMode).toBe('tasks');
  });

  it('stays in Explore when that save fails, so the draft can be retried where it lives', async () => {
    const campaign = campaignWithFields();
    await openDraft(campaign);
    useWorkStore.getState().setFormValues({ '1': 'a note' });
    vi.mocked(createAnnotationOpenmode).mockRejectedValue(new Error('network error'));
    renderSwitch(campaign);

    await clickTasks();

    expect(useWorkStore.getState().draft).toEqual({
      phase: 'draft',
      labelId: 1,
      geometry: GEOMETRY,
      savedId: null,
    });
    expect(useCampaignStore.getState().workMode).toBe('explore');
    expect(alerts).toContainEqual(expect.stringContaining('Could not save'));
  });

  it('switches straight through when nothing is open', async () => {
    const campaign = campaignWithFields();
    renderSwitch(campaign);

    await clickTasks();

    expect(useCampaignStore.getState().workMode).toBe('tasks');
  });
});
