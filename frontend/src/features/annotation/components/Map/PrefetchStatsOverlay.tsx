import { useState, useEffect, useRef } from 'react';

// Inline the stats shape so we don't depend on a non-exported type path
interface PrefetchCategoryStats { queued: number; loading: number; loaded: number; errors: number; }
interface PrefetchStats {
    queued: number; loading: number; loaded: number; errors: number; paused: boolean;
    spatialActive:    PrefetchCategoryStats;
    bgViewport:       PrefetchCategoryStats;
    bgBuffer:         PrefetchCategoryStats;
    nextNavActive:    PrefetchCategoryStats;
    nextNavBackground: PrefetchCategoryStats;
}

/** A function that registers a stats callback and returns an unsubscribe fn */
type StatsSubscriber = (cb: (stats: PrefetchStats) => void) => void;

interface Props {
    /** Subscribe function from LayerManager.onPrefetchStats — stable reference, set once */
    subscribe: StatsSubscriber | null;
}

interface CategoryRowProps {
    label: string;
    cat: PrefetchCategoryStats;
}

/** One row per prefetch category — mini progress bar + counts. */
function CategoryRow({ label, cat }: CategoryRowProps) {
    const inFlight = cat.queued + cat.loading;
    const total    = inFlight + cat.loaded;
    const pct      = total > 0 ? Math.round((cat.loaded / total) * 100) : 0;

    return (
        <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-[10px]">
                <span className="text-neutral-600 font-medium">{label}</span>
                <span className="tabular-nums">
                    {inFlight > 0
                        ? <span className="text-brand-600">
                            {cat.loading > 0 ? `↓${cat.loading}` : ''}
                            {cat.queued  > 0 ? ` ${cat.queued}q` : ''}
                          </span>
                        : <span className="text-brand-500">✓</span>
                    }
                </span>
            </div>
            {total > 0 && (
                <div className="h-0.5 rounded-full bg-neutral-200 overflow-hidden">
                    <div
                        className="h-full rounded-full transition-all duration-150 bg-brand-500"
                        style={{ width: `${pct}%` }}
                    />
                </div>
            )}
        </div>
    );
}

export default function PrefetchStatsOverlay({ subscribe }: Props) {
    const [stats, setStats] = useState<PrefetchStats | null>(null);
    const [hovered, setHovered] = useState(false);

    const subscribedRef = useRef(false);
    useEffect(() => {
        if (!subscribe || subscribedRef.current) return;
        subscribedRef.current = true;
        subscribe((s) => setStats(s));
    }, [subscribe]);

    const liveLoading = stats?.loading ?? 0;
    const liveQueued  = stats?.queued  ?? 0;
    const liveTotal   = liveLoading + liveQueued;
    const isActive    = liveTotal > 0;
    const isPaused    = stats?.paused ?? false;

    return (
        <div
            className="absolute bottom-2 left-2 z-[500] select-none"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* Pill badge */}
            <div className={`
                flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold cursor-default
                bg-white border shadow-sm transition-all duration-200
                ${isPaused  ? 'border-neutral-300 text-neutral-400'
                : isActive  ? 'border-brand-400 text-brand-600'
                :             'border-brand-400 text-brand-600'}
            `}>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    isPaused ? 'bg-neutral-400' :
                    isActive ? 'bg-brand-500 animate-pulse' :
                    'bg-brand-500'
                }`} />
                <span className="tabular-nums">
                    {isPaused ? 'Paused' : isActive ? `↓${liveLoading} · ${liveQueued}q` : 'Ready'}
                </span>
            </div>

            {/* Hover popover */}
            {hovered && stats && (
                <div className="absolute bottom-full left-0 mb-1.5 w-52 rounded bg-white border border-neutral-200 shadow-xl p-3 flex flex-col gap-2">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-neutral-700 tracking-wide uppercase">
                            Prefetch
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold border ${
                            isPaused  ? 'bg-neutral-100 border-neutral-300 text-neutral-500'
                            : isActive ? 'bg-brand-50 border-brand-300 text-brand-600'
                            :           'bg-brand-50 border-brand-300 text-brand-600'
                        }`}>
                            {isPaused ? 'Paused' : isActive ? 'Active' : 'Ready'}
                        </span>
                    </div>

                    <div className="border-t border-neutral-100" />

                    {/* Totals row */}
                    <div className="flex items-center justify-between text-[10px]">
                        <span className="text-neutral-500">Total</span>
                        <span className="tabular-nums text-neutral-600 font-medium">
                            {liveLoading > 0 && <span className="text-brand-600">↓{liveLoading} </span>}
                            {liveQueued  > 0 && <span className="text-neutral-400">{liveQueued}q </span>}
                            <span className="text-brand-500">✓{stats.loaded}</span>
                        </span>
                    </div>

                    <div className="border-t border-neutral-100" />

                    {/* Per-category rows */}
                    <div className="flex flex-col gap-2">
                        <CategoryRow label="Spatial"      cat={stats.spatialActive}     />
                        <CategoryRow label="BG viewport"  cat={stats.bgViewport}         />
                        <CategoryRow label="BG buffer"    cat={stats.bgBuffer}           />
                        <CategoryRow label="Next nav"     cat={stats.nextNavActive}      />
                        <CategoryRow label="Next nav bg"  cat={stats.nextNavBackground}  />
                    </div>

                    {!isActive && !isPaused && (
                        <div className="text-[9px] text-neutral-400 italic text-center pt-0.5">
                            All tiles cached
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
