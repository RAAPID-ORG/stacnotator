import { beforeEach, describe, expect, it } from 'vitest';
import { canEnterMode, pageKeymap, switchWorkMode } from './keymap';
import { useCampaignStore } from './stores/campaign';
import { useTasksStore } from './stores/tasks';
import { makeCampaign } from './testing/fixtures';
import { seedCampaign } from './testing/seed';

const modeBinding = () => pageKeymap().find((b) => b.key === 'm');

beforeEach(() => {
  seedCampaign(makeCampaign({ id: 5 }));
  useTasksStore.setState({ allTasks: [] });
});

describe('the M binding', () => {
  it('is offered in both modes, so switching is one key from either side', () => {
    useCampaignStore.setState({ workMode: 'explore' });
    expect(modeBinding()).toBeDefined();
    useCampaignStore.setState({ workMode: 'tasks' });
    expect(modeBinding()).toBeDefined();
  });

  it('names the mode it would take you to', () => {
    useCampaignStore.setState({ workMode: 'explore' });
    expect(modeBinding()?.help).toBe('Switch to Tasks');
    useCampaignStore.setState({ workMode: 'tasks' });
    expect(modeBinding()?.help).toBe('Switch to Explore');
  });

  // A campaign with no tasks has nothing to switch to, and the key should not
  // silently land the user on an empty task view.
  it('stands down when the other mode has nothing to offer', () => {
    useCampaignStore.setState({ workMode: 'explore' });
    expect(modeBinding()?.when?.()).toBe(false);

    useTasksStore.setState({ allTasks: [{ id: 1 }] as never });
    expect(modeBinding()?.when?.()).toBe(true);
  });
});

describe('canEnterMode', () => {
  it('lets a member into Explore when the policy allows it', () => {
    expect(canEnterMode('explore')).toBe(true);
  });

  it('refuses Explore when the campaign does not allow it', () => {
    const campaign = makeCampaign({ id: 5 });
    campaign.settings.labelling_policy.explore = { kinds: [], user_ids: [] };
    seedCampaign(campaign);
    expect(canEnterMode('explore')).toBe(false);
  });
});

describe('switchWorkMode', () => {
  it('does nothing when already in that mode', async () => {
    useCampaignStore.setState({ workMode: 'explore' });
    await switchWorkMode('explore');
    expect(useCampaignStore.getState().workMode).toBe('explore');
  });

  it('changes mode when nothing is open', async () => {
    useCampaignStore.setState({ workMode: 'explore' });
    await switchWorkMode('tasks');
    expect(useCampaignStore.getState().workMode).toBe('tasks');
  });
});
