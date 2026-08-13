import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationTaskOut, CampaignOutFull } from '~/api/client';
import { buildCatalog } from '~/features/annotation/core/catalog';
import { makeCampaign, makeTask } from '~/features/annotation/core/catalog/testHelpers';
import { useWorkStore } from '~/features/annotation/stores';
import { keyLabel, matchKey } from '~/features/annotation/engine/hotkeys';
import type { ComposeCtx } from '../../composition';
import {
  DEFAULT_CONFIDENCE,
  taskFormBindings,
  taskLabellingPolicy,
  taskWorkBindings,
} from './hotkeys';

describe('DEFAULT_CONFIDENCE', () => {
  // A fresh task with no prior annotation starts at the middle of the 1-5
  // scale, not the bottom.
  it('is 5, the middle of the scale', () => {
    expect(DEFAULT_CONFIDENCE).toBe(5);
  });
});

function ctxFor(campaign: CampaignOutFull): ComposeCtx {
  return { campaign, catalog: buildCatalog(campaign), view: null, mode: 'tasks', isMobile: false };
}

const UNASSIGNED_TASK: AnnotationTaskOut = makeTask({
  id: 1,
  annotation_number: 1,
  task_status: 'pending',
});

describe('taskLabellingPolicy', () => {
  it('denies mayLabel when unassigned_tasks excludes the viewer', () => {
    const campaign = makeCampaign({
      settings: {
        bbox_west: -10,
        bbox_south: -20,
        bbox_east: 10,
        bbox_north: 20,
        labelling_policy: {
          explore: { kinds: ['anyone'] },
          assigned_tasks: { kinds: ['anyone'] },
          complete_assigned: { kinds: ['anyone'] },
          unassigned_tasks: { kinds: [] },
        },
        labels: [],
      },
    });

    const policy = taskLabellingPolicy(ctxFor(campaign), UNASSIGNED_TASK, 'u1');

    expect(policy.mayLabel).toBe(false);
    expect(policy.countsTowardCompletion).toBe(false);
    expect(policy.isAssignedToTask).toBe(false);
  });

  it('allows mayLabel once unassigned_tasks includes anyone', () => {
    const campaign = makeCampaign({
      settings: {
        bbox_west: -10,
        bbox_south: -20,
        bbox_east: 10,
        bbox_north: 20,
        labelling_policy: {
          explore: { kinds: ['anyone'] },
          assigned_tasks: { kinds: ['anyone'] },
          complete_assigned: { kinds: [] },
          unassigned_tasks: { kinds: ['anyone'] },
        },
        labels: [],
      },
    });

    const policy = taskLabellingPolicy(ctxFor(campaign), UNASSIGNED_TASK, 'u1');

    expect(policy.mayLabel).toBe(true);
  });

  it('an assigned task may label via assigned_tasks even when complete_assigned excludes the viewer (extra label)', () => {
    const campaign = makeCampaign({
      settings: {
        bbox_west: -10,
        bbox_south: -20,
        bbox_east: 10,
        bbox_north: 20,
        labelling_policy: {
          explore: { kinds: ['anyone'] },
          assigned_tasks: { kinds: ['anyone'] },
          complete_assigned: { kinds: ['admins'] },
          unassigned_tasks: { kinds: ['anyone'] },
        },
        labels: [],
      },
    });
    const task: AnnotationTaskOut = {
      ...UNASSIGNED_TASK,
      assignments: [{ user_id: 'u1', status: 'pending' }],
    };

    const policy = taskLabellingPolicy(ctxFor(campaign), task, 'u1');

    expect(policy.isAssignedToTask).toBe(true);
    expect(policy.mayLabel).toBe(true);
    expect(policy.countsTowardCompletion).toBe(false);
  });

  it('fails open (mayLabel true) with no current task', () => {
    const campaign = makeCampaign();
    expect(taskLabellingPolicy(ctxFor(campaign), null, 'u1').mayLabel).toBe(true);
  });
});

describe('confidence bindings', () => {
  const bindings = () => taskWorkBindings(ctxFor(makeCampaign()));

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mountConfidenceControl() {
    const section = document.createElement('div');
    section.setAttribute('data-task-confidence', '');
    const scroll = vi.fn();
    section.scrollIntoView = scroll;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.setAttribute('data-task-confidence-input', '');
    section.appendChild(slider);
    document.body.appendChild(section);
    return { section, slider, scroll };
  }

  it('binds Shift+1..5 to the confidence levels, sharing one help row', () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      const binding = bindings().find((b) => b.key === `shift+${level}`);
      expect(binding, `shift+${level} is bound`).toBeDefined();
      expect(binding!.help).toBe('Set confidence level');
      expect(keyLabel(binding!.key)).toBe(`Shift+${level}`);
    }
  });

  it('fires on a real Shift+<digit> press, where e.key is the layout symbol', () => {
    const binding = bindings().find((b) => b.key === 'shift+3')!;
    const event = new KeyboardEvent('keydown', { key: '#', code: 'Digit3', shiftKey: true });

    expect(matchKey(event, binding.key)).toBe(true);

    const { slider, scroll } = mountConfidenceControl();
    binding.run(event);
    expect(useWorkStore.getState().confidence).toBe(3);
    expect(document.activeElement).toBe(slider);
    expect(scroll).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  });

  it('keeps Q/E active after moving focus to the confidence slider', () => {
    const { slider } = mountConfidenceControl();
    const decrease = bindings().find((b) => b.key === 'q')!;
    useWorkStore.getState().setConfidence(4);

    decrease.run(new KeyboardEvent('keydown', { key: 'q' }));

    expect(useWorkStore.getState().confidence).toBe(3);
    expect(document.activeElement).toBe(slider);
    expect(decrease.allowInInput).toBe(true);
    expect(decrease.when!()).toBe(true);
  });

  it('does not claim confidence hotkeys inside unrelated inputs', () => {
    const search = document.createElement('input');
    document.body.appendChild(search);
    search.focus();

    expect(bindings().find((b) => b.key === 'q')!.when!()).toBe(false);
  });
});

describe('comment binding', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reveals the comment section before focusing its textarea', () => {
    const section = document.createElement('div');
    section.setAttribute('data-task-comment', '');
    const scroll = vi.fn();
    section.scrollIntoView = scroll;
    const comment = document.createElement('textarea');
    comment.setAttribute('data-task-comment-input', '');
    section.appendChild(comment);
    document.body.appendChild(section);

    const binding = taskWorkBindings(ctxFor(makeCampaign())).find((b) => b.key === 'c')!;
    binding.run(new KeyboardEvent('keydown', { key: 'c' }));

    expect(document.activeElement).toBe(comment);
    expect(scroll).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  });
});

describe('form bindings while the user is typing', () => {
  const campaignWithFields = () =>
    makeCampaign({
      settings: {
        ...makeCampaign().settings,
        form_fields: [{ id: 7, title: 'Notes', required: false, type: 'text' }],
      },
    });
  const formBindings = () => taskFormBindings(ctxFor(campaignWithFields()));
  const binding = (key: string) => formBindings().find((b) => b.key === key)!;

  afterEach(() => {
    document.body.innerHTML = '';
    useWorkStore.getState().setActiveFieldIndex(null);
  });

  // Enter focuses a field's input, which is where the registry's typing guard
  // would otherwise strand the user: no way back to the field cycle.
  it('lets Tab and Escape through the typing guard', () => {
    expect(binding('tab').allowInInput).toBe(true);
    expect(binding('shift+tab').allowInInput).toBe(true);
    expect(binding('escape').allowInInput).toBe(true);
  });

  it('Escape unfocuses the active field', () => {
    useWorkStore.getState().setActiveFieldIndex(0);
    const escape = binding('escape');

    expect(escape.when!()).toBe(true);
    escape.run(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(useWorkStore.getState().activeFieldIndex).toBeNull();
  });

  it('Escape is the comment box exit, even with no field focused', () => {
    const comment = document.createElement('textarea');
    comment.setAttribute('data-task-comment-input', '');
    document.body.appendChild(comment);
    comment.focus();
    expect(document.activeElement).toBe(comment);

    const escape = binding('escape');
    expect(escape.when!()).toBe(true);
    escape.run(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.activeElement).not.toBe(comment);
  });

  it('Escape stays out of the way when nothing is focused at all', () => {
    expect(binding('escape').when!()).toBe(false);
  });

  it('Tab cycles the fields rather than the browser focus ring', () => {
    const tab = binding('tab');

    tab.run(new KeyboardEvent('keydown', { key: 'Tab' }));

    expect(useWorkStore.getState().activeFieldIndex).toBe(0);
  });

  it('leaves Tab and Escape to the browser inside an input that is not this form', () => {
    const search = document.createElement('input');
    document.body.appendChild(search);
    search.focus();
    useWorkStore.getState().setActiveFieldIndex(0);

    expect(binding('tab').when!()).toBe(false);
    expect(binding('escape').when!()).toBe(false);
  });

  it('keeps them alive inside a field input of this very form', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-form-field-id', '7');
    const input = document.createElement('input');
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);
    input.focus();
    useWorkStore.getState().setActiveFieldIndex(0);

    expect(binding('tab').when!()).toBe(true);
    expect(binding('escape').when!()).toBe(true);
  });

  // Regression: handleFormFieldKey never names a field to focus for Tab (the
  // new slot may hold no input at all), so without this the store's
  // activeFieldIndex moved on but the caret stayed behind in field 7's input.
  it('Tab moves DOM focus out of the old field input and into the new one', () => {
    const secondField = campaignWithFields();
    secondField.settings.form_fields = [
      { id: 7, title: 'Notes', required: false, type: 'text' },
      { id: 8, title: 'More notes', required: false, type: 'text' },
    ];
    const tabBindings = taskFormBindings(ctxFor(secondField));
    const tab = tabBindings.find((b) => b.key === 'tab')!;

    const wrapper7 = document.createElement('div');
    wrapper7.setAttribute('data-form-field-id', '7');
    const input7 = document.createElement('input');
    wrapper7.appendChild(input7);
    const wrapper8 = document.createElement('div');
    wrapper8.setAttribute('data-form-field-id', '8');
    const scrollField8 = vi.fn();
    wrapper8.scrollIntoView = scrollField8;
    const input8 = document.createElement('input');
    wrapper8.appendChild(input8);
    document.body.append(wrapper7, wrapper8);

    useWorkStore.getState().setActiveFieldIndex(0);
    input7.focus();
    expect(document.activeElement).toBe(input7);

    tab.run(new KeyboardEvent('keydown', { key: 'Tab' }));

    expect(useWorkStore.getState().activeFieldIndex).toBe(1);
    expect(document.activeElement).toBe(input8);
    expect(scrollField8).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  });

  it('Tab reveals and focuses an option field that has no text input', () => {
    const campaign = campaignWithFields();
    campaign.settings.form_fields = [
      { id: 7, title: 'Notes', required: false, type: 'text' },
      {
        id: 8,
        title: 'Condition',
        required: false,
        type: 'category',
        options: [{ id: 81, name: 'Healthy' }],
      },
    ];
    const tab = taskFormBindings(ctxFor(campaign)).find((b) => b.key === 'tab')!;

    const wrapper7 = document.createElement('div');
    wrapper7.setAttribute('data-form-field-id', '7');
    const input7 = document.createElement('input');
    wrapper7.appendChild(input7);
    const wrapper8 = document.createElement('div');
    wrapper8.setAttribute('data-form-field-id', '8');
    wrapper8.tabIndex = -1;
    const scrollField8 = vi.fn();
    wrapper8.scrollIntoView = scrollField8;
    document.body.append(wrapper7, wrapper8);

    useWorkStore.getState().setActiveFieldIndex(0);
    input7.focus();
    tab.run(new KeyboardEvent('keydown', { key: 'Tab' }));

    expect(useWorkStore.getState().activeFieldIndex).toBe(1);
    expect(document.activeElement).toBe(wrapper8);
    expect(scrollField8).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  });

  it('Tab reveals and focuses the label section when the field cycle wraps', () => {
    const campaign = campaignWithFields();
    const tab = taskFormBindings(ctxFor(campaign)).find((b) => b.key === 'tab')!;
    const labels = document.createElement('div');
    labels.setAttribute('data-task-labels', '');
    labels.tabIndex = -1;
    const scrollLabels = vi.fn();
    labels.scrollIntoView = scrollLabels;
    document.body.appendChild(labels);
    useWorkStore.getState().setActiveFieldIndex(0);

    tab.run(new KeyboardEvent('keydown', { key: 'Tab' }));

    expect(useWorkStore.getState().activeFieldIndex).toBe(-1);
    expect(document.activeElement).toBe(labels);
    expect(scrollLabels).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  });

  // Regression: Escape cleared activeFieldIndex in the store but never
  // touched the DOM, so the caret - and every subsequent keystroke - stayed
  // trapped in the field's input with no keyboard way out.
  it('Escape blurs a focused field input, not just the comment box', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-form-field-id', '7');
    const input = document.createElement('input');
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);

    useWorkStore.getState().setActiveFieldIndex(0);
    input.focus();
    expect(document.activeElement).toBe(input);

    binding('escape').run(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(useWorkStore.getState().activeFieldIndex).toBeNull();
    expect(document.activeElement).not.toBe(input);
  });
});

describe('form field focus', () => {
  it('Enter on a typed field focuses that field input, from the feature layer', () => {
    const campaign = makeCampaign({
      settings: {
        ...makeCampaign().settings,
        form_fields: [{ id: 7, title: 'Notes', required: false, type: 'text' }],
      },
    });
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-form-field-id', '7');
    const input = document.createElement('input');
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);
    useWorkStore.getState().setActiveFieldIndex(0);

    const enter = taskFormBindings(ctxFor(campaign)).find((b) => b.key === 'enter')!;
    expect(enter.when!()).toBe(true);
    enter.run(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(document.activeElement).toBe(input);

    document.body.innerHTML = '';
    useWorkStore.getState().setActiveFieldIndex(null);
  });
});
