export type TourVariant = 'tasks' | 'explore';

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right';

/** Where the spotlight goes. `panel` is a canvas panel id (resolved through
 *  PanelHost's data-panel-id); `role` is the feature a panel came from, for
 *  panels whose id is data-dependent (one imagery window, one timeseries
 *  chart); `anchor` is a `data-tour` name on page chrome that is not a panel
 *  (the toolbar and its menus). */
export type TourTarget =
  | { kind: 'panel'; id: string }
  | { kind: 'role'; name: string }
  | { kind: 'anchor'; name: string };

export interface TourBullet {
  text: string;
  sub?: string[];
}

/** What a step does to the workspace when it is entered. `edit-layout` is the
 *  one the user has to finish (it fulfils the step); the rest only prime the
 *  workspace so the step's copy is true when it is shown. */
export type TourEffect =
  | 'edit-layout'
  | 'annotate-tool'
  | 'slice-headroom'
  | 'collection-headroom'
  /** Hold a header picker's menu open, so a step can talk about what is in it. */
  | 'show-collection-menu'
  | 'show-slice-menu'
  | 'show-layer-menu'
  /** Practise switching imagery without keeping whatever it was left on: the
   *  ring includes basemaps, so a step that ends on one leaves the next step
   *  talking about imagery over a plain street map. */
  | 'imagery-sandbox'
  /** As above, and start on a source whose current date actually publishes
   *  more than one visualization - otherwise there is nothing to cycle. */
  | 'visualization-sandbox'
  /** Probe the middle of the view so the chart has a line to look at. */
  | 'seed-probe';

export interface TourStep {
  id: string;
  /** Several targets are all lit; the first one anchors the tooltip. */
  target: TourTarget | TourTarget[];
  title: string;
  /** Paragraphs. `{{<key spec>}}` renders as a key chip labelled from the live
   *  hotkey registry, so copy can never advertise an unbound shortcut. */
  body: string[];
  bullets?: TourBullet[];
  /** The italic "try it now" nudge under the body. */
  hint?: string;
  /** Preferred side of the first target. The tooltip moves off it rather than
   *  cover anything it lights up or has been told to keep clear. */
  placement?: TourPlacement;
  /** Elements the tooltip must not sit on even though the step does not light
   *  them - a control the reader still has to reach to finish the step. */
  avoid?: TourTarget | TourTarget[];
  /** Binding key specs the user must each press once to fulfil the step. */
  requiredKeys?: string[];
  /** Fulfilled by clicking the target instead of pressing a key. */
  requiredClick?: boolean;
  requiredClickLabel?: string;
  /** 'edit-layout' turns layout editing on when the step is entered, is
   *  fulfilled when the user leaves it (Save or Cancel), and turns it back off
   *  if the step is left while it is still on. */
  effect?: TourEffect;
  /** Two-column shortcut recap on the closing step. A row carries either key
   *  specs (rendered as chips from the live registry) or `text`, for the rows
   *  whose shortcut is a range rather than one binding (the label digits). */
  cheatSheet?: Array<{ label: string; keys?: string[]; text?: string }>;
}

export interface TourState {
  index: number;
  /** Required keys seen so far on the current step. */
  pressed: string[];
  fulfilled: boolean;
  /** The tour widened the task filter on open and owes a restore on close. */
  filterBroadened: boolean;
  /** The current step turned layout editing on and owes a revert. */
  layoutEditActive: boolean;
}

export type TourEvent =
  | { type: 'open'; broadenFilter: boolean }
  | { type: 'key'; key: string }
  | { type: 'click' }
  | { type: 'layout-editing'; editing: boolean }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'close' };

export type TourCommand =
  | { type: 'broaden-filter' }
  | { type: 'restore-filter' }
  | { type: 'start-layout-edit' }
  | { type: 'stop-layout-edit' }
  | { type: 'select-annotate-tool' }
  /** Step off a boundary so the practice step's two directions both do
   *  something - a task usually opens on the first slice/collection, where
   *  "go back" would silently be a no-op. */
  | { type: 'ensure-headroom'; scale: 'slice' | 'collection' }
  | { type: 'open-control'; name: string | null }
  | { type: 'save-imagery' }
  | { type: 'restore-imagery' }
  | { type: 'focus-multi-viz-source' }
  | { type: 'seed-probe' }
  | { type: 'clear-seeded-probe' }
  | { type: 'close' };

export interface TourTransition {
  state: TourState;
  commands: TourCommand[];
}

export const INITIAL_TOUR_STATE: TourState = {
  index: 0,
  pressed: [],
  fulfilled: false,
  filterBroadened: false,
  layoutEditActive: false,
};

/** True while the step still demands something of the user, i.e. "Next" is
 *  disabled. */
export function canAdvance(step: TourStep | undefined, state: TourState): boolean {
  if (!step) return true;
  const interactive =
    step.requiredKeys != null || step.requiredClick === true || step.effect === 'edit-layout';
  return !interactive || state.fulfilled;
}

export function progressPct(steps: TourStep[], state: TourState): number {
  if (steps.length === 0) return 0;
  return Math.round(((state.index + 1) / steps.length) * 100);
}

/** What a step's effect does on the way in, and what it owes on the way out.
 *  A step that changes the workspace to make its own copy true has to put it
 *  back, or every later step inherits the demonstration. */
const EFFECT_COMMANDS: Record<TourEffect, { enter: TourCommand[]; leave: TourCommand[] }> = {
  'edit-layout': { enter: [{ type: 'start-layout-edit' }], leave: [] },
  'annotate-tool': { enter: [{ type: 'select-annotate-tool' }], leave: [] },
  'slice-headroom': { enter: [{ type: 'ensure-headroom', scale: 'slice' }], leave: [] },
  'collection-headroom': { enter: [{ type: 'ensure-headroom', scale: 'collection' }], leave: [] },
  'show-collection-menu': {
    enter: [{ type: 'open-control', name: 'collection-picker' }],
    leave: [{ type: 'open-control', name: null }],
  },
  'show-slice-menu': {
    enter: [{ type: 'open-control', name: 'slice-picker' }],
    leave: [{ type: 'open-control', name: null }],
  },
  'show-layer-menu': {
    enter: [{ type: 'open-control', name: 'layer-selector' }],
    leave: [{ type: 'open-control', name: null }],
  },
  'imagery-sandbox': {
    enter: [{ type: 'save-imagery' }],
    leave: [{ type: 'restore-imagery' }],
  },
  'visualization-sandbox': {
    enter: [{ type: 'save-imagery' }, { type: 'focus-multi-viz-source' }],
    leave: [{ type: 'restore-imagery' }],
  },
  'seed-probe': {
    enter: [{ type: 'seed-probe' }],
    leave: [{ type: 'clear-seeded-probe' }],
  },
};

function enterCommands(step: TourStep | undefined): TourCommand[] {
  return step?.effect ? EFFECT_COMMANDS[step.effect].enter : [];
}

function leaveCommands(steps: TourStep[], state: TourState): TourCommand[] {
  const step = steps[state.index];
  return [
    ...(state.layoutEditActive ? ([{ type: 'stop-layout-edit' }] as TourCommand[]) : []),
    ...(step?.effect ? EFFECT_COMMANDS[step.effect].leave : []),
  ];
}

function finishCommands(steps: TourStep[], state: TourState): TourCommand[] {
  return [
    ...leaveCommands(steps, state),
    ...(state.filterBroadened ? ([{ type: 'restore-filter' }] as TourCommand[]) : []),
    { type: 'close' },
  ];
}

/** Moving to `index`: clears the per-step fulfilment, reverts the step being
 *  left and primes the one being entered. */
function moveTo(steps: TourStep[], state: TourState, index: number): TourTransition {
  return {
    state: {
      ...state,
      index,
      pressed: [],
      fulfilled: false,
      layoutEditActive: false,
    },
    commands: [...leaveCommands(steps, state), ...enterCommands(steps[index])],
  };
}

export function reduce(steps: TourStep[], state: TourState, event: TourEvent): TourTransition {
  const step = steps[state.index];

  switch (event.type) {
    case 'open': {
      // A filter widened by an earlier open is still widened: the tour restarts
      // when the work mode changes under it, and forgetting here would orphan
      // the caller's saved filter - nothing would ever ask for it back.
      const opened: TourState = {
        ...INITIAL_TOUR_STATE,
        filterBroadened: event.broadenFilter || state.filterBroadened,
      };
      return {
        state: opened,
        commands: [
          ...(event.broadenFilter ? ([{ type: 'broaden-filter' }] as TourCommand[]) : []),
          ...enterCommands(steps[0]),
        ],
      };
    }

    case 'key': {
      if (!step?.requiredKeys || state.fulfilled) return { state, commands: [] };
      const key = event.key.toLowerCase();
      if (!step.requiredKeys.some((k) => k.toLowerCase() === key)) return { state, commands: [] };
      if (state.pressed.includes(key)) return { state, commands: [] };
      const pressed = [...state.pressed, key];
      const fulfilled = step.requiredKeys.every((k) => pressed.includes(k.toLowerCase()));
      return { state: { ...state, pressed, fulfilled }, commands: [] };
    }

    case 'click': {
      if (step?.requiredClick !== true || state.fulfilled) return { state, commands: [] };
      return { state: { ...state, fulfilled: true }, commands: [] };
    }

    case 'layout-editing': {
      if (step?.effect !== 'edit-layout') return { state, commands: [] };
      if (event.editing) return { state: { ...state, layoutEditActive: true }, commands: [] };
      // Leaving edit mode only counts once the tour actually put the user in
      // it - the store's initial `editing: false` must not fulfil the step.
      if (!state.layoutEditActive) return { state, commands: [] };
      return { state: { ...state, layoutEditActive: false, fulfilled: true }, commands: [] };
    }

    case 'next': {
      if (state.index >= steps.length - 1) return { state, commands: finishCommands(steps, state) };
      return moveTo(steps, state, state.index + 1);
    }

    case 'back': {
      if (state.index === 0) return { state, commands: [] };
      return moveTo(steps, state, state.index - 1);
    }

    case 'close':
      return { state, commands: finishCommands(steps, state) };
  }
}
