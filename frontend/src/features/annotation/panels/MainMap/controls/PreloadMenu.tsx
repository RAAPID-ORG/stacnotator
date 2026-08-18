import { useEffect, useRef, useState } from 'react';
import { usePrefsStore, type PreloadTier } from '../../../stores/prefs';
import {
  PRELOAD_TIER_CONCURRENCY,
  autoPreloadTier,
  resolvePreloadTier,
  usePreloadProgress,
} from '../usePreloading';

/** Bars shown while nothing is queued yet, so the control keeps its width. */
const IDLE_BARS = [0, 0, 0];

const LABEL: Record<PreloadTier, string> = {
  auto: 'Auto',
  off: 'Off',
  conservative: 'Conservative',
  balanced: 'Balanced',
  heavy: 'Heavy',
};

/** One bar per upcoming task, nearest first, filling as its tiles land. A
 *  bar that reaches the top fades back to a resting tone: warm is the calm
 *  state, and only the tasks still loading should draw the eye. */
function PreloadBars({ percents, active }: { percents: readonly number[]; active: boolean }) {
  return (
    <span className="flex h-[14px] items-end gap-[2px]" aria-hidden>
      {percents.map((percent, index) => (
        <span
          key={index}
          className="relative h-full w-[3px] overflow-hidden rounded-full bg-neutral-200"
        >
          <span
            className={`absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-300 ${
              !active ? 'bg-neutral-300' : percent >= 100 ? 'bg-brand-300' : 'bg-brand-600'
            }`}
            style={{ height: `${percent}%` }}
          />
        </span>
      ))}
    </span>
  );
}

export function PreloadMenu() {
  const tier = usePrefsStore((s) => s.preloadTier);
  const setPreloadTier = usePrefsStore((s) => s.setPreloadTier);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const doc = rootRef.current?.ownerDocument ?? document;
    doc.addEventListener('mousedown', onPointerDown);
    return () => doc.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const auto = autoPreloadTier();
  const effective = resolvePreloadTier(tier);
  const active = effective !== 'off';
  const progress = usePreloadProgress();
  const percents = active && progress.length > 0 ? progress : IDLE_BARS;
  const ahead = active
    ? `Next tasks ${percents.map((p) => `${p}%`).join(' / ')} preloaded`
    : 'Nothing preloaded ahead';

  const options: Array<{ tier: PreloadTier; hint: string }> = [
    { tier: 'auto', hint: `tuned to your connection (currently ${LABEL[auto].toLowerCase()})` },
    { tier: 'off', hint: 'no preloading' },
    {
      tier: 'conservative',
      hint: `${PRELOAD_TIER_CONCURRENCY.conservative} parallel - slow links`,
    },
    { tier: 'balanced', hint: `${PRELOAD_TIER_CONCURRENCY.balanced} parallel - typical 4G/wifi` },
    { tier: 'heavy', hint: `${PRELOAD_TIER_CONCURRENCY.heavy} parallel - fast wired/wifi` },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="preload-menu"
        data-preload-progress={percents.join(',')}
        aria-label={`Tile preloading: ${LABEL[effective]}. ${ahead}.`}
        title={`Tile preloading: ${LABEL[effective]}${tier === 'auto' ? ' (auto-tuned to your connection)' : ''}. ${ahead}. Click to change.`}
        className="flex h-6 items-center justify-center rounded-md px-1 cursor-pointer hover:bg-neutral-100"
      >
        <PreloadBars percents={percents} active={active} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-neutral-200 bg-white py-1 text-xs shadow-lg"
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-neutral-400">
            Tile preloading
          </div>
          {options.map((option) => (
            <button
              key={option.tier}
              type="button"
              role="menuitemradio"
              aria-checked={tier === option.tier}
              onClick={() => {
                setPreloadTier(option.tier);
                setOpen(false);
              }}
              className={`flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 ${tier === option.tier ? 'bg-neutral-50' : ''}`}
            >
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full">
                {tier === option.tier && (
                  <span className="block h-1.5 w-1.5 rounded-full bg-brand-600" />
                )}
              </span>
              <span className="flex-1">
                <span className="block text-neutral-800">{LABEL[option.tier]}</span>
                <span className="block text-[10px] text-neutral-400">{option.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
