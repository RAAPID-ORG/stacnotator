import {
  readyCustomMaps,
  type Catalog,
  type SliceAddress,
} from '~/features/annotation/core/catalog';
import { useImageryStore, useSessionStore } from '~/features/annotation/stores';
import { keyLabel, type Binding } from '~/features/annotation/engine/hotkeys';
import type { ComposeCtx } from '../../composition';
import { fallbackCollectionFor } from '../../shared/viewSelection';
import { fitAnnotations, pan, recenter, zoom } from './cameraBus';

/** Holding A/D scrubs the time series at a readable cadence; OS key-repeat is
 *  far too fast for imagery to keep up with. */
const AUTONAV_INTERVAL_MS = 500;

/**
 * Where each source was last looked at, so cycling back to a source returns to
 * its own collection/slice instead of resetting to its first. Domain's
 * cycleSource takes this as a parameter precisely so the caller owns it; the
 * map is that caller.
 */
const lastBySource: Record<number, SliceAddress> = {};

let autoNavTimer: ReturnType<typeof setInterval> | null = null;
let autoNavStop: (() => void) | null = null;

function stopAutoNav(): void {
  if (autoNavTimer) clearInterval(autoNavTimer);
  autoNavTimer = null;
  autoNavStop?.();
  autoNavStop = null;
}

/** Repeats `step` until the key comes back up (or the window loses focus,
 *  which never delivers that keyup). */
function startAutoNav(step: () => void): void {
  stopAutoNav();
  autoNavTimer = setInterval(step, AUTONAV_INTERVAL_MS);
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'd') stopAutoNav();
  };
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', stopAutoNav);
  autoNavStop = () => {
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', stopAutoNav);
  };
}

function stepSlice(cat: Catalog, dir: 1 | -1): void {
  useImageryStore.getState().stepSliceAction(cat, dir);
}

function stepCollection(cat: Catalog, dir: 1 | -1): void {
  useImageryStore.getState().stepCollectionAction(cat, dir);
}

export function mainMapBindings(ctx: ComposeCtx): Binding[] {
  const { catalog, view, mode } = ctx;
  const views = ctx.campaign.imagery_views;

  const cycleSource = (dir: 1 | -1) => {
    if (!view) return;
    const imagery = useImageryStore.getState();
    if (imagery.address) lastBySource[imagery.address.sourceId] = imagery.address;
    imagery.cycleSourceAction(catalog, view, dir, lastBySource);
  };

  const cycleView = () => {
    if (views.length <= 1) return;
    const { selectedViewId, selectView } = useSessionStore.getState();
    const index = views.findIndex((v) => v.id === selectedViewId);
    const next = views[(index + 1) % views.length];
    selectView(next.id, catalog, fallbackCollectionFor(catalog, next.id, next.source_ids));
  };

  const overlays = () => readyCustomMaps([...catalog.customMaps.values()]);
  const vectorLayers = () => [...catalog.vectorLayers.values()];
  const hasVectorLayers = () => mode === 'explore' && catalog.vectorLayers.size > 0;

  /** Steps once, then keeps stepping while the key is held. */
  const scrub = (key: string, help: string, step: () => void): Binding => ({
    key,
    help,
    run: () => {
      step();
      startAutoNav(step);
    },
  });

  return [
    scrub('a', 'Previous slice', () => stepSlice(catalog, -1)),
    scrub('d', 'Next slice', () => stepSlice(catalog, 1)),
    scrub('shift+a', 'Previous collection', () => stepCollection(catalog, -1)),
    scrub('shift+d', 'Next collection', () => stepCollection(catalog, 1)),

    { key: 'i', help: 'Cycle imagery source', run: () => cycleSource(1) },
    {
      key: 'shift+i',
      help: 'Cycle visualization',
      run: () => useImageryStore.getState().cycleVizAction(catalog, 1),
    },

    {
      key: 'o',
      help: 'Toggle overlay layer',
      run: () => useImageryStore.getState().overlayAction(overlays(), 'toggle'),
    },
    {
      key: 'shift+o',
      help: 'Cycle overlay layers',
      run: () => useImageryStore.getState().overlayAction(overlays(), 'cycle'),
    },

    // Reference vector layers are Explore-only, and only where the campaign
    // has any.
    {
      key: 'v',
      help: 'Toggle vector layer',
      when: hasVectorLayers,
      run: () => useImageryStore.getState().vectorAction(vectorLayers(), 'toggle'),
    },
    {
      key: 'shift+v',
      help: 'Cycle vector layers',
      when: hasVectorLayers,
      run: () => useImageryStore.getState().vectorAction(vectorLayers(), 'cycle'),
    },

    { key: 'u', help: 'Cycle view', run: cycleView },
    {
      key: 'l',
      help: 'Toggle view link (sync windows)',
      run: () => useImageryStore.getState().toggleViewSync(),
    },
    { key: 'x', help: 'Toggle crosshair', run: () => useImageryStore.getState().toggleCrosshair() },
    {
      key: 'shift+x',
      help: 'Toggle drawn objects',
      run: () => useImageryStore.getState().toggleAnnotations(),
    },

    { key: 'arrowup', help: 'Pan map up', allowRepeat: true, run: () => pan('up') },
    { key: 'arrowdown', help: 'Pan map down', allowRepeat: true, run: () => pan('down') },
    { key: 'arrowleft', help: 'Pan map left', allowRepeat: true, run: () => pan('left') },
    { key: 'arrowright', help: 'Pan map right', allowRepeat: true, run: () => pan('right') },
    { key: 'alt+arrowup', help: 'Zoom in', allowRepeat: true, run: () => zoom(1) },
    { key: 'alt+arrowdown', help: 'Zoom out', allowRepeat: true, run: () => zoom(-1) },

    {
      key: ' ',
      // One key, two meanings, so the help text carries both rather than the
      // panel maintaining a second copy of the rule.
      help: 'Recenter map on the task (tasks) / fit to all annotations (explore)',
      run: () => {
        if (mode === 'tasks') recenter();
        else void fitAnnotations(catalog.campaignId);
      },
    },
  ];
}

/** Test/teardown seam: the auto-nav timer outlives a binding table. */
export function stopSliceAutoNav(): void {
  stopAutoNav();
}

/** Everything this module remembers between keypresses, dropped. Both are
 *  scoped to one campaign's catalog: a held-down A/D that outlives the page
 *  would keep stepping slices of a campaign nobody is on, and `lastBySource`
 *  keyed by source id would send the next campaign's source cycling to an
 *  address from the last one. */
export function resetMainMapNav(): void {
  stopAutoNav();
  for (const key of Object.keys(lastBySource)) delete lastBySource[Number(key)];
}

/** Button tooltip taken from the binding itself, so a control can never
 *  advertise a key it is not bound to. */
export function hotkeyTip(bindings: Binding[], key: string, fallback = ''): string {
  const binding = bindings.find((b) => b.key === key);
  return binding ? `${binding.help} (${keyLabel(binding.key)})` : fallback;
}
