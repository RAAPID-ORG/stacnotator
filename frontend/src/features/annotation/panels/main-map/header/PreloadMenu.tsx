import { useEffect, useRef, useState } from 'react';
import { usePrefsStore, type PreloadTier } from '~/features/annotation/stores';
import { IconGauge } from '~/shared/ui/Icons';
import { PRELOAD_TIER_CONCURRENCY, autoPreloadTier, resolvePreloadTier } from '../usePreloading';

const DOT: Record<PreloadTier, string> = {
  auto: 'bg-brand-500',
  off: 'bg-neutral-300',
  conservative: 'bg-amber-400',
  balanced: 'bg-emerald-400',
  heavy: 'bg-emerald-600',
};

const LABEL: Record<PreloadTier, string> = {
  auto: 'Auto',
  off: 'Off',
  conservative: 'Conservative',
  balanced: 'Balanced',
  heavy: 'Heavy',
};

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
        title={`Tile preloading: ${LABEL[effective]}${tier === 'auto' ? ' (auto-tuned to your connection)' : ''}. Click to change.`}
        className={`relative flex h-6 w-6 items-center justify-center rounded-md cursor-pointer ${active ? 'bg-brand-600 text-white hover:bg-brand-700' : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500'}`}
      >
        <IconGauge className="h-[13px] w-[13px]" />
        <span
          className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-white ${DOT[effective]}`}
          aria-hidden
        />
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
