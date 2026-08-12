import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceStore } from '~/features/annotation/stores';
import { getHelp, keyLabel, onAnyBinding } from '~/features/annotation/engine/hotkeys';
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
import { buildTourSteps } from './steps';

export interface TourOverlayProps {
  open: boolean;
  variant: TourVariant;
  hasTimeseries: boolean;
  /** Tasks mode with nothing visible under the current filter: the tour widens
   *  it for its duration so the task steps have something to walk through. */
  needsBroaderFilter?: boolean;
  onBroadenFilter?: () => void;
  onRestoreFilter?: () => void;
  onClose: () => void;
}

/** Gap between the target's spotlight and the tooltip, and the padding the
 *  spotlight adds around the target's own bounding box. */
const GAP = 16;
const SPOTLIGHT_PAD = 6;
const TOOLTIP_FALLBACK = { width: 380, height: 200 };
/** Re-measure cadence, so the spotlight tracks a dropdown opening or a panel
 *  being dragged without every such component reporting to the tour. */
const REPOSITION_MS = 300;
/** Breather between fulfilling a step and moving on, so the user sees it tick. */
const AUTO_ADVANCE_MS = 800;

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

function findTarget(target: TourTarget): Element | null {
  return document.querySelector(selectorFor(target));
}

function sameBox(a: DOMRect, b: DOMRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function KeyChip({ spec }: { spec: string }) {
  const bound = getHelp().some((row) => row.key === spec);
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

/** Splits copy on `{{<key spec>}}` and renders those parts as key chips. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/\{\{(.*?)\}\}/g);
  return <>{parts.map((part, i) => (i % 2 === 0 ? part : <KeyChip key={i} spec={part} />))}</>;
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
  if (!step.requiredKeys && !step.requiredClick && !step.effect) return null;

  return (
    <div
      className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2.5"
      data-testid="tour-action-hint"
      data-fulfilled={done}
    >
      <span className="text-xs font-medium text-neutral-600">
        {done
          ? 'Done!'
          : step.effect
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
  needsBroaderFilter = false,
  onBroadenFilter,
  onRestoreFilter,
  onClose,
}: TourOverlayProps) {
  const steps = useMemo(() => buildTourSteps(variant, { hasTimeseries }), [variant, hasTimeseries]);
  const [state, setState] = useState<TourState>(INITIAL_TOUR_STATE);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  const step: TourStep | undefined = steps[state.index];
  const editing = useWorkspaceStore((s) => s.editing);

  // Commands are run from a ref-stable callback so the effects below don't have
  // to list every page callback in their dependencies.
  const handlers = useRef({ onBroadenFilter, onRestoreFilter, onClose });
  handlers.current = { onBroadenFilter, onRestoreFilter, onClose };

  const runCommand = useCallback((command: TourCommand) => {
    const workspace = useWorkspaceStore.getState();
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

  useEffect(() => {
    if (!open || step?.requiredClick !== true) return;
    const onClick = (e: MouseEvent) => {
      const target = step.target && findTarget(step.target);
      if (target && e.target instanceof Node && target.contains(e.target))
        dispatch({ type: 'click' });
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
    const element = findTarget(step.target);
    if (!element) {
      setRect(null);
      setTooltipStyle((current) =>
        current.transform === 'translate(-50%, -50%)'
          ? current
          : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
      );
      return;
    }

    // Re-measured a few times a second; only a real move should re-render.
    const box = element.getBoundingClientRect();
    setRect((current) => (current && sameBox(current, box) ? current : box));

    const width = tooltipRef.current?.offsetWidth ?? TOOLTIP_FALLBACK.width;
    const height = tooltipRef.current?.offsetHeight ?? TOOLTIP_FALLBACK.height;
    let top = 0;
    let left = 0;
    switch (step.placement ?? 'bottom') {
      case 'bottom':
        top = box.bottom + GAP;
        left = box.left + box.width / 2 - width / 2;
        break;
      case 'top':
        top = box.top - height - GAP;
        left = box.left + box.width / 2 - width / 2;
        break;
      case 'left':
        top = box.top + box.height / 2 - height / 2;
        left = box.left - width - GAP;
        break;
      case 'right':
        top = box.top + box.height / 2 - height / 2;
        left = box.right + GAP;
        break;
    }

    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
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
    findTarget(step?.target ?? { kind: 'anchor', name: 'toolbar' })?.scrollIntoView({
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

  // Auto-advance once a practice step is satisfied, so the user never has to
  // move their hand back to the mouse mid-drill.
  useEffect(() => {
    if (!open || !state.fulfilled) return;
    const timer = setTimeout(() => dispatch({ type: 'next' }), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [open, state.fulfilled, state.index, dispatch]);

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
            {rect && (
              <rect
                x={rect.left - SPOTLIGHT_PAD}
                y={rect.top - SPOTLIGHT_PAD}
                width={rect.width + SPOTLIGHT_PAD * 2}
                height={rect.height + SPOTLIGHT_PAD * 2}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#tour-spotlight-mask)" />
      </svg>

      {rect && (
        <div
          className="pointer-events-none absolute animate-pulse rounded-lg border-2 border-brand-400"
          style={{
            left: rect.left - SPOTLIGHT_PAD,
            top: rect.top - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
            boxShadow: '0 0 0 4px rgba(65,120,93,0.2)',
          }}
        />
      )}

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
