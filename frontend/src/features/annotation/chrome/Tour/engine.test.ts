import { describe, expect, it } from 'vitest';
import {
  canAdvance,
  INITIAL_TOUR_STATE,
  progressPct,
  reduce,
  type TourState,
  type TourStep,
} from './engine';
import { buildTourSteps } from './steps';

const step = (overrides: Partial<TourStep> = {}): TourStep => ({
  id: 'step',
  target: { kind: 'anchor', name: 'toolbar' },
  title: 'Title',
  body: ['Body'],
  ...overrides,
});

const PLAIN = [step({ id: 'a' }), step({ id: 'b' }), step({ id: 'c' })];

/** Applies a series of events, threading state through. */
function run(steps: TourStep[], events: Parameters<typeof reduce>[2][], from = INITIAL_TOUR_STATE) {
  let state = from;
  const commands = [];
  for (const event of events) {
    const next = reduce(steps, state, event);
    state = next.state;
    commands.push(...next.commands);
  }
  return { state, commands };
}

describe('tour engine navigation', () => {
  it('starts on the first step and steps forward and back', () => {
    const forward = run(PLAIN, [{ type: 'open', broadenFilter: false }, { type: 'next' }]);
    expect(forward.state.index).toBe(1);
    expect(forward.commands).toEqual([]);

    const back = reduce(PLAIN, forward.state, { type: 'back' });
    expect(back.state.index).toBe(0);
  });

  it('never steps back past the first step', () => {
    expect(reduce(PLAIN, INITIAL_TOUR_STATE, { type: 'back' }).state.index).toBe(0);
  });

  it('closes instead of advancing past the last step', () => {
    const state: TourState = { ...INITIAL_TOUR_STATE, index: PLAIN.length - 1 };
    expect(reduce(PLAIN, state, { type: 'next' }).commands).toEqual([{ type: 'close' }]);
  });

  it('reports progress as a percentage of the step count', () => {
    expect(progressPct(PLAIN, INITIAL_TOUR_STATE)).toBe(33);
    expect(progressPct(PLAIN, { ...INITIAL_TOUR_STATE, index: 2 })).toBe(100);
  });
});

describe('tour engine fulfilment', () => {
  const keySteps = [step({ id: 'keys', requiredKeys: ['a', 'shift+d'] }), step({ id: 'after' })];

  it('blocks advancing until every required key has been pressed once', () => {
    let state = INITIAL_TOUR_STATE;
    expect(canAdvance(keySteps[0], state)).toBe(false);

    state = reduce(keySteps, state, { type: 'key', key: 'a' }).state;
    expect(canAdvance(keySteps[0], state)).toBe(false);
    // A repeat of an already-pressed key is not the second distinct press.
    state = reduce(keySteps, state, { type: 'key', key: 'a' }).state;
    expect(canAdvance(keySteps[0], state)).toBe(false);

    state = reduce(keySteps, state, { type: 'key', key: 'shift+d' }).state;
    expect(state.fulfilled).toBe(true);
    expect(canAdvance(keySteps[0], state)).toBe(true);
  });

  it('ignores keys the step does not ask for', () => {
    const state = reduce(keySteps, INITIAL_TOUR_STATE, { type: 'key', key: 'z' }).state;
    expect(state.pressed).toEqual([]);
  });

  it('resets fulfilment when the step changes', () => {
    const { state } = run(keySteps, [
      { type: 'key', key: 'a' },
      { type: 'key', key: 'shift+d' },
      { type: 'next' },
    ]);
    expect(state.index).toBe(1);
    expect(state.pressed).toEqual([]);
    expect(state.fulfilled).toBe(false);
  });

  it('fulfils a click step on a click on its target', () => {
    const clickSteps = [step({ id: 'click', requiredClick: true })];
    expect(canAdvance(clickSteps[0], INITIAL_TOUR_STATE)).toBe(false);
    expect(reduce(clickSteps, INITIAL_TOUR_STATE, { type: 'click' }).state.fulfilled).toBe(true);
  });

  it('treats a non-interactive step as immediately advanceable', () => {
    expect(canAdvance(PLAIN[0], INITIAL_TOUR_STATE)).toBe(true);
  });
});

describe('tour engine edit-layout side effect', () => {
  const steps = [
    step({ id: 'plain' }),
    step({ id: 'edit', effect: 'edit-layout' }),
    step({ id: 'last' }),
  ];

  it('turns layout editing on when the step is entered', () => {
    const { commands } = run(steps, [{ type: 'open', broadenFilter: false }, { type: 'next' }]);
    expect(commands).toEqual([{ type: 'start-layout-edit' }]);
  });

  it('fulfils the step when the user leaves edit mode, and reverts nothing on the way out', () => {
    const entered = run(steps, [{ type: 'open', broadenFilter: false }, { type: 'next' }]);
    const editing = reduce(steps, entered.state, { type: 'layout-editing', editing: true });
    expect(editing.state.layoutEditActive).toBe(true);
    expect(editing.state.fulfilled).toBe(false);

    const saved = reduce(steps, editing.state, { type: 'layout-editing', editing: false });
    expect(saved.state.fulfilled).toBe(true);

    // Already out of edit mode, so leaving the step must not toggle it again.
    expect(reduce(steps, saved.state, { type: 'next' }).commands).toEqual([]);
  });

  it('ignores an editing:false report before the tour turned editing on', () => {
    const entered = run(steps, [{ type: 'open', broadenFilter: false }, { type: 'next' }]);
    const ignored = reduce(steps, entered.state, { type: 'layout-editing', editing: false });
    expect(ignored.state.fulfilled).toBe(false);
  });

  it('reverts edit mode when the step is left while still editing', () => {
    const entered = run(steps, [{ type: 'open', broadenFilter: false }, { type: 'next' }]);
    const editing = reduce(steps, entered.state, { type: 'layout-editing', editing: true });
    expect(reduce(steps, editing.state, { type: 'next' }).commands).toEqual([
      { type: 'stop-layout-edit' },
    ]);
    expect(reduce(steps, editing.state, { type: 'back' }).commands).toEqual([
      { type: 'stop-layout-edit' },
    ]);
    expect(reduce(steps, editing.state, { type: 'close' }).commands).toEqual([
      { type: 'stop-layout-edit' },
      { type: 'close' },
    ]);
  });
});

describe('tour engine task-filter broadening', () => {
  it('broadens on open and restores when the tour finishes', () => {
    const opened = reduce(PLAIN, INITIAL_TOUR_STATE, { type: 'open', broadenFilter: true });
    expect(opened.commands).toEqual([{ type: 'broaden-filter' }]);
    expect(opened.state.filterBroadened).toBe(true);

    const finished = run(
      PLAIN,
      [{ type: 'next' }, { type: 'next' }, { type: 'next' }],
      opened.state
    );
    expect(finished.commands).toEqual([{ type: 'restore-filter' }, { type: 'close' }]);
  });

  it('restores when the tour is skipped mid-way', () => {
    const opened = reduce(PLAIN, INITIAL_TOUR_STATE, { type: 'open', broadenFilter: true });
    const skipped = run(PLAIN, [{ type: 'next' }, { type: 'close' }], opened.state);
    expect(skipped.commands).toEqual([{ type: 'restore-filter' }, { type: 'close' }]);
  });

  // Switching the work mode rebuilds the steps, which restarts the tour: the
  // filter widened for Tasks is still widened, and only this state remembers
  // that anyone owes the caller a restore.
  it('keeps owing the restore when the tour restarts without broadening again', () => {
    const opened = reduce(PLAIN, INITIAL_TOUR_STATE, { type: 'open', broadenFilter: true });
    const restarted = reduce(PLAIN, opened.state, { type: 'open', broadenFilter: false });

    expect(restarted.commands).toEqual([]);
    expect(restarted.state.filterBroadened).toBe(true);
    expect(reduce(PLAIN, restarted.state, { type: 'close' }).commands).toEqual([
      { type: 'restore-filter' },
      { type: 'close' },
    ]);
  });

  it('restores nothing when the filter was never broadened', () => {
    const opened = reduce(PLAIN, INITIAL_TOUR_STATE, { type: 'open', broadenFilter: false });
    expect(opened.commands).toEqual([]);
    expect(reduce(PLAIN, opened.state, { type: 'close' }).commands).toEqual([{ type: 'close' }]);
  });
});

describe('tour steps content', () => {
  it('builds both variants, gated on whether the campaign has time series', () => {
    const withTs = buildTourSteps('tasks', { hasTimeseries: true, hasFormFields: true });
    const withoutTs = buildTourSteps('tasks', { hasTimeseries: false, hasFormFields: true });
    expect(withTs.length).toBe(withoutTs.length + 1);
    expect(withTs.some((s) => s.id === 'timeseries')).toBe(true);
    expect(withoutTs.some((s) => s.id === 'timeseries')).toBe(false);

    const explore = buildTourSteps('explore', { hasTimeseries: true, hasFormFields: true });
    expect(explore[0].title).toContain('Explore');
    expect(explore.some((s) => s.id === 'timeseries')).toBe(true);
  });

  it('gives every step a unique id and every variant a closing step', () => {
    for (const variant of ['tasks', 'explore'] as const) {
      for (const hasTimeseries of [true, false]) {
        for (const hasFormFields of [true, false]) {
          const steps = buildTourSteps(variant, { hasTimeseries, hasFormFields });
          expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
          expect(steps[steps.length - 1].cheatSheet?.length).toBeGreaterThan(0);
          expect(canAdvance(steps[steps.length - 1], INITIAL_TOUR_STATE)).toBe(true);
        }
      }
    }
  });

  it('teaches drawing, editing and deleting in explore mode', () => {
    const explore = buildTourSteps('explore', { hasTimeseries: false, hasFormFields: false });
    const drawing = explore.find((s) => s.id === 'drawing');
    const editing = explore.find((s) => s.id === 'editing');
    expect(drawing).toBeDefined();
    expect(editing).toBeDefined();
    expect(drawing!.bullets?.some((b) => b.text.includes('{{escape}}'))).toBe(true);
    expect(editing!.bullets?.some((b) => b.text.includes('{{delete}}'))).toBe(true);
  });

  it('only walks through the annotation questions when the campaign asks any', () => {
    for (const variant of ['tasks', 'explore'] as const) {
      const withFields = buildTourSteps(variant, { hasTimeseries: false, hasFormFields: true });
      const without = buildTourSteps(variant, { hasTimeseries: false, hasFormFields: false });
      const mentions = (steps: typeof withFields) =>
        JSON.stringify(steps).includes('{{tab}}') ||
        steps.some((s) => s.id === 'annotation-questions');
      expect(mentions(withFields)).toBe(true);
      expect(mentions(without)).toBe(false);
    }
  });

  it('never advances a practice step on its own - the reducer only moves on a next event', () => {
    const steps = buildTourSteps('explore', { hasTimeseries: false, hasFormFields: false });
    const practice = steps.findIndex((s) => s.requiredKeys != null);
    const fulfilled = steps[practice].requiredKeys!.reduce(
      (state, key) => reduce(steps, state, { type: 'key', key }).state,
      { ...INITIAL_TOUR_STATE, index: practice }
    );
    expect(canAdvance(steps[practice], fulfilled)).toBe(true);
    expect(fulfilled.index).toBe(practice);
  });

  it('targets panels by id rather than a CSS selector', () => {
    const targets = buildTourSteps('tasks', { hasTimeseries: true, hasFormFields: true }).flatMap(
      (s) => (Array.isArray(s.target) ? s.target : [s.target])
    );
    expect(targets.some((t) => t.kind === 'panel' && t.id === 'main')).toBe(true);
    expect(targets.some((t) => t.kind === 'panel' && t.id === 'controls')).toBe(true);
    for (const target of targets) {
      const name = target.kind === 'panel' ? target.id : target.name;
      expect(name).not.toContain('[');
    }
  });

  it('opens on a plain step and closes on the canvas view, not the other way round', () => {
    for (const variant of ['tasks', 'explore'] as const) {
      const steps = buildTourSteps(variant, { hasTimeseries: true, hasFormFields: true });
      expect(steps[0].id).toBe('welcome');
      const viewStep = steps.findIndex((s) => s.id.startsWith('canvas-view'));
      expect(viewStep).toBeGreaterThan(steps.length / 2);
    }
  });
});
