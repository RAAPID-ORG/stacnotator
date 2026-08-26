import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { IconProbe } from '~/shared/ui/Icons';
import type { LonLat } from '~/shared/map/types';
import {
  collectionAddress,
  snapshotForView,
  stepCollectionId,
  stepSlice,
  type ViewSnapshot,
} from '../../campaign/imageryNav';
import { mainCamera } from '../../map/camera';
import { useCampaignStore } from '../../stores/campaign';
import { useImageryStore } from '../../stores/imagery';
import { useLayoutStore } from '../../stores/layout';
import { MAX_PROBES, useWorkStore } from '../../stores/work';
import { helpRows, keyLabel, onAnyBinding } from '../../hotkeys';
import {
  canAdvance,
  INITIAL_TOUR_STATE,
  progressPct,
  reduce,
  type TourBullet,
  type TourCommand,
  type TourEvent,
  type TourState,
  type TourStep,
  type TourTarget,
  type TourVariant,
} from './engine';
import { placeTooltip, type Box } from './placement';
import { buildTourSteps } from './steps';

export interface TourOverlayProps {
  open: boolean;
  variant: TourVariant;
  hasTimeseries: boolean;
  hasFormFields: boolean;
  /** Tasks mode with nothing visible under the current filter: the tour widens
   *  it for its duration so the task steps have something to walk through. */
  needsBroaderFilter?: boolean;
  onBroadenFilter?: () => void;
  onRestoreFilter?: () => void;
  onClose: () => void;
}

/** Padding the spotlight adds around a target's own bounding box. */
const SPOTLIGHT_PAD = 6;
const TOOLTIP_FALLBACK = { width: 380, height: 200 };
/** Re-measure cadence, so the spotlight tracks a dropdown opening or a panel
 *  being dragged without every such component reporting to the tour. */
const REPOSITION_MS = 300;

function selectorFor(target: TourTarget): string {
  switch (target.kind) {
    case 'panel':
      return `[data-panel-id="${target.id}"]`;
    case 'role':
      return `[data-panel-role="${target.name}"]`;
    case 'anchor':
      return `[data-tour="${target.name}"]`;
  }
}

/** Every element a step lights up. A role matches all the panels that came
 *  from that feature (all the imagery windows, not just the first). */
function findTargets(target: TourStep['target']): Element[] {
  const targets = Array.isArray(target) ? target : [target];
  return targets.flatMap((one) =>
    one.kind === 'role'
      ? [...document.querySelectorAll(selectorFor(one))]
      : [document.querySelector(selectorFor(one))].filter((el) => el !== null)
  );
}

/** The spotlight's own outline, which is what the tooltip has to clear. */
function padded(box: DOMRect): Box {
  return {
    left: box.left - SPOTLIGHT_PAD,
    top: box.top - SPOTLIGHT_PAD,
    width: box.width + SPOTLIGHT_PAD * 2,
    height: box.height + SPOTLIGHT_PAD * 2,
  };
}

function sameBox(a: DOMRect, b: DOMRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function sameBoxes(a: DOMRect[], b: DOMRect[]): boolean {
  return a.length === b.length && a.every((box, i) => sameBox(box, b[i]));
}

/** The workspace usually opens on the first slice/collection, where "previous"
 *  is a no-op: step forward once so a practice step's two directions both do
 *  something. */
function ensureHeadroom(scale: 'slice' | 'collection'): void {
  const catalog = useCampaignStore.getState().catalog;
  const imagery = useImageryStore.getState();
  const address = imagery.address;
  if (!catalog || !address) return;
  const canGoBack =
    scale === 'slice'
      ? stepSlice(catalog, address, -1, imagery.empties) !== null
      : stepCollectionId(catalog, address, -1) !== null;
  if (canGoBack) return;
  if (scale === 'slice') imagery.stepSliceAction(catalog, 1);
  else imagery.stepCollectionAction(catalog, 1);
}

/** Where a seeded probe goes: what the user is looking at, pulled back inside
 *  the campaign area, since outside it the backend has nothing to chart. */
function probeTarget(): LonLat {
  const bbox = useCampaignStore.getState().catalog?.bbox;
  const [lon, lat] = mainCamera.getState().center;
  if (!bbox) return [lon, lat];
  const [west, south, east, north] = bbox;
  return [Math.min(Math.max(lon, west), east), Math.min(Math.max(lat, south), north)];
}

/**
 * Land on a source whose visible date publishes more than one visualization.
 * Cycling visualizations is not worth practising on a source that has one, and
 * the copy would be describing something the reader cannot make happen.
 */
function focusMultiVizSource(): void {
  const { catalog, view } = useCampaignStore.getState();
  const imagery = useImageryStore.getState();
  if (!catalog || !view) return;

  const publishesTwo = (sourceId: number, collectionId: number, sliceIndex: number): boolean => {
    const source = catalog.sources.get(sourceId);
    const slice = catalog.collections.get(collectionId)?.slices[sliceIndex];
    if (!source || !slice) return false;
    const published = source.visualizations.filter((viz) =>
      slice.tile_urls.some((tile) => tile.visualization_name === viz.name)
    );
    return published.length > 1;
  };

  const here = imagery.address;
  if (
    here &&
    !imagery.showBasemap &&
    publishesTwo(here.sourceId, here.collectionId, here.sliceIndex)
  ) {
    return;
  }

  for (const sourceId of view.source_ids) {
    for (const collection of catalog.sources.get(sourceId)?.collections ?? []) {
      const sliceIndex = collection.slices.findIndex((_, i) =>
        publishesTwo(sourceId, collection.id, i)
      );
      if (sliceIndex === -1) continue;
      const address = collectionAddress(catalog, collection.id, null, sliceIndex);
      if (!address) continue;
      imagery.setAddress(address);
      imagery.setShowBasemap(false);
      return;
    }
  }
}

function KeyChip({ spec }: { spec: string }) {
  const bound = helpRows().some((row) => row.key === spec);
  return (
    <kbd
      className={`mx-0.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
        bound
          ? 'border-neutral-300 bg-neutral-100 text-neutral-700'
          : 'border-dashed border-neutral-300 text-neutral-400'
      }`}
      title={bound ? undefined : 'Not bound in this mode'}
      data-testid={`tour-key-${spec}`}
    >
      {keyLabel(spec)}
    </kbd>
  );
}

/** Controls a step can point at by drawing them, rather than describing where
 *  on screen they are and what they look like. */
export const INLINE_ICON_NAMES = ['probe'] as const;

const INLINE_ICONS: Record<string, ReactNode> = {
  probe: <IconProbe className="mx-0.5 inline h-3.5 w-3.5 align-text-bottom text-neutral-700" />,
};

/** Splits copy on `{{...}}`: `icon:<name>` draws a control, anything else is a
 *  key spec rendered as a chip from the live hotkey registry. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/\{\{(.*?)\}\}/g);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        if (part.startsWith('icon:')) {
          return <span key={i}>{INLINE_ICONS[part.slice('icon:'.length)]}</span>;
        }
        return <KeyChip key={i} spec={part} />;
      })}
    </>
  );
}

function Bullets({ bullets }: { bullets: TourBullet[] }) {
  return (
    <ul className="list-inside list-disc space-y-1 text-sm">
      {bullets.map((bullet) => (
        <li key={bullet.text}>
          <RichText text={bullet.text} />
          {bullet.sub && (
            <ul className="ml-4 list-inside list-disc space-y-1">
              {bullet.sub.map((sub) => (
                <li key={sub}>
                  <RichText text={sub} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function StepBody({ step }: { step: TourStep }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-neutral-700">
      {step.body.map((paragraph) => (
        <p key={paragraph}>
          <RichText text={paragraph} />
        </p>
      ))}
      {step.bullets && <Bullets bullets={step.bullets} />}
      {step.hint && <p className="text-sm italic text-neutral-500">{step.hint}</p>}
      {step.cheatSheet && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {step.cheatSheet.map((row) => (
            <div key={row.label} className="contents">
              <span className="text-neutral-600">{row.label}</span>
              <span className="text-right">
                {row.text ? (
                  <kbd className="mx-0.5 rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700">
                    {row.text}
                  </kbd>
                ) : (
                  row.keys?.map((key) => <KeyChip key={key} spec={key} />)
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the step still wants, shown under the copy. */
function ActionHint({ step, state }: { step: TourStep; state: TourState }) {
  const done = state.fulfilled;
  const waitsForLayoutEdit = step.effect === 'edit-layout';
  if (!step.requiredKeys && !step.requiredClick && !waitsForLayoutEdit) return null;

  return (
    <div
      className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2.5"
      data-testid="tour-action-hint"
      data-fulfilled={done}
    >
      <span className="text-xs font-medium text-neutral-600">
        {done
          ? 'Done - hit Next when you are ready.'
          : waitsForLayoutEdit
            ? 'Drag a panel edge to resize, then click Save or Cancel.'
            : null}
        {!done &&
          step.requiredClick &&
          `Click ${step.requiredClickLabel ?? 'the highlighted element'}`}
        {!done && step.requiredKeys && 'Press'}
      </span>
      {!done && step.requiredKeys && (
        <span className="flex gap-1">
          {step.requiredKeys.map((key) => (
            <kbd
              key={key}
              className={`rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] font-semibold ${
                state.pressed.includes(key.toLowerCase())
                  ? 'text-neutral-400 line-through'
                  : 'bg-neutral-100 text-neutral-700'
              }`}
            >
              {keyLabel(key)}
            </kbd>
          ))}
        </span>
      )}
    </div>
  );
}

export function TourOverlay({
  open,
  variant,
  hasTimeseries,
  hasFormFields,
  needsBroaderFilter = false,
  onBroadenFilter,
  onRestoreFilter,
  onClose,
}: TourOverlayProps) {
  const steps = useMemo(
    () => buildTourSteps(variant, { hasTimeseries, hasFormFields }),
    [variant, hasTimeseries, hasFormFields]
  );
  const [state, setState] = useState<TourState>(INITIAL_TOUR_STATE);
  const [rects, setRects] = useState<DOMRect[]>([]);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  const step: TourStep | undefined = steps[state.index];
  const editing = useLayoutStore((s) => s.editing);

  // Commands are run from a ref-stable callback so the effects below don't have
  // to list every page callback in their dependencies.
  const handlers = useRef({ onBroadenFilter, onRestoreFilter, onClose });
  handlers.current = { onBroadenFilter, onRestoreFilter, onClose };

  // What the tour changed and owes back. Refs, not state: nothing renders from
  // them, and a command must see the value the previous command wrote.
  const savedImagery = useRef<ViewSnapshot | null>(null);
  const seededProbe = useRef<number | null>(null);

  const runCommand = useCallback((command: TourCommand) => {
    const workspace = useLayoutStore.getState();
    switch (command.type) {
      case 'broaden-filter':
        handlers.current.onBroadenFilter?.();
        break;
      case 'restore-filter':
        handlers.current.onRestoreFilter?.();
        break;
      case 'start-layout-edit':
        workspace.startEditing();
        break;
      case 'stop-layout-edit':
        // Cancel, not save: the user was told to experiment and never pressed
        // Save, so the tour must not commit whatever they dragged.
        workspace.cancelEditing();
        break;
      case 'select-annotate-tool':
        void useWorkStore.getState().selectTool('annotate');
        break;
      case 'ensure-headroom':
        ensureHeadroom(command.scale);
        break;
      case 'open-control':
        workspace.setForcedOpenControl(command.name);
        break;
      case 'save-imagery':
        savedImagery.current = snapshotForView(useImageryStore.getState());
        break;
      case 'restore-imagery':
        if (savedImagery.current) useImageryStore.getState().reset(savedImagery.current);
        savedImagery.current = null;
        break;
      case 'focus-multi-viz-source':
        focusMultiVizSource();
        break;
      case 'seed-probe': {
        // Never at the cap: the eviction there would drop a probe the user
        // placed themselves, which the tour has no business doing.
        const work = useWorkStore.getState();
        if (work.probePoints.length >= MAX_PROBES) break;
        work.probeAt(probeTarget());
        seededProbe.current = useWorkStore.getState().probePoints.length - 1;
        break;
      }
      case 'clear-seeded-probe':
        if (seededProbe.current !== null) {
          useWorkStore.getState().removeProbePoint(seededProbe.current);
        }
        seededProbe.current = null;
        break;
      case 'close':
        handlers.current.onClose();
        break;
    }
  }, []);

  // Transitions are computed off a ref, not inside a setState updater: the
  // engine's commands call store actions and page callbacks, and an updater
  // has to stay pure (StrictMode invokes it twice).
  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatch = useCallback(
    (event: TourEvent) => {
      const next = reduce(steps, stateRef.current, event);
      stateRef.current = next.state;
      setState(next.state);
      for (const command of next.commands) runCommand(command);
    },
    [steps, runCommand]
  );

  // Opening resets to step one (and may widen the task filter). Closing is
  // driven by the engine's `close` command, so there is nothing to undo here.
  useEffect(() => {
    if (!open) return;
    dispatch({ type: 'open', broadenFilter: needsBroaderFilter });
    // needsBroaderFilter is read once, at open: whether the filter had to be
    // widened is then the engine's state, not a live prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dispatch]);

  useEffect(() => {
    if (!open) return;
    return onAnyBinding((key) => dispatch({ type: 'key', key }));
  }, [open, dispatch]);

  // A tour that goes away without a close event - the page unmounting under it -
  // still owes the workspace the menu it was holding open.
  useEffect(() => () => useLayoutStore.getState().setForcedOpenControl(null), []);

  useEffect(() => {
    if (!open || step?.requiredClick !== true) return;
    const onClick = (e: MouseEvent) => {
      const hit = findTargets(step.target).some(
        (element) => e.target instanceof Node && element.contains(e.target)
      );
      if (hit) dispatch({ type: 'click' });
    };
    window.addEventListener('click', onClick, { capture: true });
    return () => window.removeEventListener('click', onClick, { capture: true });
  }, [open, step, dispatch]);

  useEffect(() => {
    if (!open) return;
    dispatch({ type: 'layout-editing', editing });
  }, [open, editing, dispatch]);

  // Escape closes, ahead of any binding that also claims it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      dispatch({ type: 'close' });
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, dispatch]);

  const position = useCallback(() => {
    if (!step) return;
    // The first target anchors the tooltip; the rest are only lit.
    const [element, ...rest] = findTargets(step.target);
    if (!element) {
      setRects([]);
      setTooltipStyle((current) =>
        current.transform === 'translate(-50%, -50%)'
          ? current
          : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
      );
      return;
    }

    // Re-measured a few times a second; only a real move should re-render.
    const box = element.getBoundingClientRect();
    const boxes = [box, ...rest.map((el) => el.getBoundingClientRect())];
    setRects((current) => (sameBoxes(current, boxes) ? current : boxes));

    const size = {
      width: tooltipRef.current?.offsetWidth ?? TOOLTIP_FALLBACK.width,
      height: tooltipRef.current?.offsetHeight ?? TOOLTIP_FALLBACK.height,
    };
    const keepClear = [
      ...boxes.map(padded),
      ...(step.avoid
        ? findTargets(step.avoid).map((el) => padded(el.getBoundingClientRect()))
        : []),
    ];
    const { left, top } = placeTooltip(
      padded(box),
      size,
      keepClear,
      { width: window.innerWidth, height: window.innerHeight },
      step.placement
    );
    // Same reason as the rect above: re-measured a few times a second, so only
    // a real move should produce a new style object (and a re-render).
    setTooltipStyle((current) =>
      current.top === `${top}px` && current.left === `${left}px`
        ? current
        : { position: 'fixed', top: `${top}px`, left: `${left}px` }
    );
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    position();
    findTargets(step?.target ?? { kind: 'anchor', name: 'toolbar' })[0]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
    const timer = setInterval(position, REPOSITION_MS);
    window.addEventListener('resize', position);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', position);
    };
  }, [open, position, step]);

  if (!open || !step) return null;

  const isLast = state.index === steps.length - 1;
  const blocked = !canAdvance(step, state);

  return (
    <div
      className="fixed inset-0 z-[10000]"
      style={{ pointerEvents: 'none' }}
      data-testid="tour-overlay"
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <mask id="tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {rects.map((box, i) => (
              <rect
                key={i}
                x={box.left - SPOTLIGHT_PAD}
                y={box.top - SPOTLIGHT_PAD}
                width={box.width + SPOTLIGHT_PAD * 2}
                height={box.height + SPOTLIGHT_PAD * 2}
                rx="8"
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#tour-spotlight-mask)" />
      </svg>

      {rects.map((box, i) => (
        <div
          key={i}
          className="pointer-events-none absolute animate-pulse rounded-lg border-2 border-brand-400"
          style={{
            left: box.left - SPOTLIGHT_PAD,
            top: box.top - SPOTLIGHT_PAD,
            width: box.width + SPOTLIGHT_PAD * 2,
            height: box.height + SPOTLIGHT_PAD * 2,
            boxShadow: '0 0 0 4px rgba(65,120,93,0.2)',
          }}
        />
      ))}

      <div
        ref={tooltipRef}
        data-testid="tour-tooltip"
        className="w-[380px] max-w-[92vw] rounded-xl border border-neutral-200 bg-white p-4 shadow-2xl"
        style={{ ...tooltipStyle, pointerEvents: 'auto' }}
      >
        <div className="absolute left-0 right-0 top-0 h-1 overflow-hidden rounded-t-xl bg-neutral-200">
          <div
            className="h-full bg-brand-600 transition-all"
            style={{ width: `${progressPct(steps, state)}%` }}
          />
        </div>

        <div className="mb-2 flex items-center justify-between pt-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            Step {state.index + 1} of {steps.length}
          </span>
          <button
            type="button"
            onClick={() => dispatch({ type: 'close' })}
            title="Close tour (Esc)"
            aria-label="Close tour"
            className="text-neutral-400 transition-colors hover:text-neutral-600"
          >
            x
          </button>
        </div>

        <h3 className="mb-2 text-base font-bold text-neutral-900">{step.title}</h3>
        <StepBody step={step} />
        <ActionHint step={step} state={state} />

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => dispatch({ type: 'back' })}
            disabled={state.index === 0}
            className="px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Back
          </button>
          <div className="flex gap-2">
            {!isLast && (
              <button
                type="button"
                onClick={() => dispatch({ type: 'close' })}
                className="px-3 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-700"
              >
                Skip Tour
              </button>
            )}
            <button
              type="button"
              onClick={() => dispatch({ type: 'next' })}
              disabled={blocked}
              data-testid="tour-next"
              className="rounded-md bg-brand-600 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
