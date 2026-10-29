import { beforeEach, describe, expect, it } from 'vitest';
import { pageKeymap } from './keymap';
import { useCampaignStore } from './stores/campaign';
import { useTasksStore } from './stores/tasks';
import { makeCampaign, makeTask } from './testing/fixtures';
import { seedCampaign } from './testing/seed';

const done = () => pageKeymap().find((b) => b.key === 'shift+enter');

function seed(taskOutput: 'draw' | 'classify') {
  const campaign = makeCampaign({ id: 5 });
  campaign.settings.task_output = taskOutput;
  seedCampaign(campaign);
  const task = makeTask({ id: 1 });
  useCampaignStore.setState({ workMode: 'tasks' });
  useTasksStore.setState({
    allTasks: [task],
    visibleTasks: [task],
    currentIndex: 0,
    isSubmitting: false,
  });
}

describe('the Done key on draw tasks', () => {
  beforeEach(() => seed('draw'));

  it('is Shift+Enter, since Enter finishes the shape being drawn', () => {
    expect(done()).toBeDefined();
    expect(done()?.when?.()).toBe(true);
  });

  it('stands down while a submission is in flight', () => {
    useTasksStore.setState({ isSubmitting: true });
    expect(done()?.when?.()).toBe(false);
  });

  it('is not bound on classify tasks, where Enter submits', () => {
    seed('classify');
    expect(done()).toBeUndefined();
  });
});
