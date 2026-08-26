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

describe('effects that change the workspace put it back', () => {
  const SANDBOX = [
    step({ id: 'before' }),
    step({ id: 'sandbox', effect: 'imagery-sandbox' }),
    step({ id: 'after' }),
  ];

  it('saves on the way in and restores on the way out', () => {
    const entered = run(SANDBOX, [{ type: 'open', broadenFilter: false }, { type: 'next' }]);
    expect(entered.commands).toEqual([{ type: 'save-imagery' }]);

    const left = reduce(SANDBOX, entered.state, { type: 'next' });
    expect(left.commands).toEqual([{ type: 'restore-imagery' }]);
  });

  it('restores when the step is left backwards, not only forwards', () => {
    const entered = run(SANDBOX, [{ type: 'open', broadenFilter: false }, { type: 'next' }]);
    const back = reduce(SANDBOX, entered.state, { type: 'back' });
    expect(back.commands).toEqual([{ type: 'restore-imagery' }]);
  });

  it('restores when the tour is closed mid-step', () => {
    const entered = run(SANDBOX, [{ type: 'open', broadenFilter: false }, { type: 'next' }]);
    const closed = reduce(SANDBOX, entered.state, { type: 'close' });
    expect(closed.commands).toEqual([{ type: 'restore-imagery' }, { type: 'close' }]);
  });

  it('closes a menu it held open', () => {
    const steps = [step({ id: 'menu', effect: 'show-slice-menu' }), step({ id: 'next' })];
    const opened = reduce(steps, INITIAL_TOUR_STATE, { type: 'open', broadenFilter: false });
    expect(opened.commands).toEqual([{ type: 'open-control', name: 'slice-picker' }]);
    expect(reduce(steps, opened.state, { type: 'next' }).commands).toEqual([
      { type: 'open-control', name: null },
    ]);
  });

  it('takes back the probe it dropped', () => {
    const steps = [step({ id: 'chart', effect: 'seed-probe' }), step({ id: 'next' })];
    const opened = reduce(steps, INITIAL_TOUR_STATE, { type: 'open', broadenFilter: false });
    expect(opened.commands).toEqual([{ type: 'seed-probe' }]);
    expect(reduce(steps, opened.state, { type: 'close' }).commands).toEqual([
      { type: 'clear-seeded-probe' },
      { type: 'close' },
    ]);
  });

  it('primes a visualization source before talking about cycling them', () => {
    const steps = [step({ id: 'viz', effect: 'visualization-sandbox' })];
    const opened = reduce(steps, INITIAL_TOUR_STATE, { type: 'open', broadenFilter: false });
    expect(opened.commands).toEqual([{ type: 'save-imagery' }, { type: 'focus-multi-viz-source' }]);
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

  it('teaches collections and slices as one step, with both pickers lit', () => {
    for (const variant of ['tasks', 'explore'] as const) {
      const steps = buildTourSteps(variant, { hasTimeseries: false, hasFormFields: false });
      const merged = steps.find((s) => s.id === 'collections-and-slices');
      expect(merged).toBeDefined();
      expect(steps.some((s) => s.id === 'collection-picker' || s.id === 'windows-vs-slices')).toBe(
        false
      );
      const targets = Array.isArray(merged!.target) ? merged!.target : [merged!.target];
      const names = targets.map((t) => (t.kind === 'panel' ? t.id : t.name));
      expect(names).toContain('collection-picker');
      expect(names).toContain('slice-picker');
      // The open menu is portaled out of the trigger, so it has to be lit itself.
      expect(names).toContain('slice-picker-menu');
      expect(merged!.effect).toBe('show-slice-menu');
    }
  });

  it('shows the main map alongside every step that describes what it does', () => {
    const showsMap = (id: string, steps: TourStep[]) => {
      const found = steps.find((s) => s.id === id);
      if (!found) return true;
      const targets = Array.isArray(found.target) ? found.target : [found.target];
      return targets.some((t) => t.kind === 'panel' && t.id === 'main');
    };
    for (const variant of ['tasks', 'explore'] as const) {
      const steps = buildTourSteps(variant, { hasTimeseries: true, hasFormFields: true });
      for (const id of [
        'imagery-windows',
        'practice-slices',
        'practice-windows',
        'imagery-sources',
        'visualizations',
        'controls',
        'drawing',
        'editing',
        'annotation-questions',
        'timeseries',
      ]) {
        expect(showsMap(id, steps), `${variant}/${id}`).toBe(true);
      }
    }
  });

  it('makes switching sources and visualizations something you do, not read', () => {
    for (const variant of ['tasks', 'explore'] as const) {
      const steps = buildTourSteps(variant, { hasTimeseries: false, hasFormFields: false });
      const sources = steps.find((s) => s.id === 'imagery-sources')!;
      const viz = steps.find((s) => s.id === 'visualizations')!;
      expect(sources.requiredKeys).toEqual(['i']);
      expect(viz.requiredKeys).toEqual(['shift+i']);
      // Both leave the imagery where they found it - the source ring includes
      // basemaps, and a later step must not open on one.
      expect(sources.effect).toBe('imagery-sandbox');
      expect(viz.effect).toBe('visualization-sandbox');
    }
  });

  it('does not claim view sync shares the slice, which it never did', () => {
    for (const variant of ['tasks', 'explore'] as const) {
      const steps = buildTourSteps(variant, { hasTimeseries: false, hasFormFields: false });
      const body = steps.find((s) => s.id === 'view-sync')!.body.join(' ');
      expect(body).not.toContain('slice index');
      expect(body).toContain('pan and zoom');
    }
  });

  it('keeps the tooltip off controls a step still needs the reader to click', () => {
    const named = (target: TourStep['avoid']) =>
      (Array.isArray(target) ? target : target ? [target] : []).map((t) =>
        t.kind === 'panel' ? t.id : t.name
      );
    for (const variant of ['tasks', 'explore'] as const) {
      const steps = buildTourSteps(variant, { hasTimeseries: false, hasFormFields: false });
      expect(named(steps.find((s) => s.id === 'practice-resize')!.avoid)).toContain('toolbar');
      expect(named(steps.find((s) => s.id === 'practice-google-earth')!.avoid)).toContain(
        'minimap'
      );
    }
  });

  it('opens the task filter and lights the panel, not just its button', () => {
    const steps = buildTourSteps('tasks', { hasTimeseries: false, hasFormFields: false });
    const filter = steps.find((s) => s.id === 'task-filter')!;
    const targets = Array.isArray(filter.target) ? filter.target : [filter.target];
    expect(targets.map((t) => (t.kind === 'panel' ? t.id : t.name))).toContain('task-filter-menu');
    expect(filter.effect).toBe('show-task-filter');
  });

  it('keeps the main map step off both sets of controls it names', () => {
    for (const variant of ['tasks', 'explore'] as const) {
      const steps = buildTourSteps(variant, { hasTimeseries: false, hasFormFields: false });
      const avoid = steps.find((s) => s.id === 'main-map')!.avoid;
      const names = (Array.isArray(avoid) ? avoid : avoid ? [avoid] : []).map((t) =>
        t.kind === 'panel' ? t.id : t.name
      );
      expect(names).toContain('map-controls');
    }
  });

  it('describes closing a shape the ways it can actually be closed', () => {
    const steps = buildTourSteps('explore', { hasTimeseries: false, hasFormFields: false });
    const drawing = steps.find((s) => s.id === 'drawing')!;
    const shapes = drawing.bullets!.map((b) => b.text).join(' ');
    expect(shapes).toContain('{{enter}}');
    expect(shapes).toContain('double-click');
    expect(shapes).toContain('first corner');
  });

  it('tells task-mode annotators the chart can probe somewhere other than the task', () => {
    const steps = buildTourSteps('tasks', { hasTimeseries: true, hasFormFields: false });
    const chart = steps.find((s) => s.id === 'timeseries')!.body.join(' ');
    expect(chart).toContain('{{icon:probe}}');
    expect(chart).toContain('click anywhere on the map');
    expect(chart).toContain('compared');
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
