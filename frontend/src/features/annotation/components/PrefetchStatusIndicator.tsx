import { useState, useEffect, useRef, memo } from 'react';
import type { PrefetchStatsSnapshot } from '../components/Map/layerManager';

interface PrefetchStatusIndicatorProps {
    /** Subscribe to stats - called once on mount. Returns unsubscribe fn. */
    getStats: () => PrefetchStatsSnapshot | null;
    /** Called by the hook's onStats. We buffer here to avoid render storms. */
    statsRef: React.RefObject<PrefetchStatsSnapshot | null>;
}

/**
 * A compact, unobtrusive prefetch status indicator.
 *
 * Shows a tiny pill in the bottom-left of the map area:
 *   - Pulsing dot + count while tiles are loading
 *   - Checkmark when idle
 *   - Expandable on hover for per-category breakdown
 *
 * The component polls the stats ref at 500ms intervals to avoid coupling
 * React renders to the PrefetchManager's high-frequency callbacks.
 */
const PrefetchStatusIndicator = ({ statsRef }: PrefetchStatusIndicatorProps) => {
    const [stats, setStats] = useState<PrefetchStatsSnapshot | null>(null);
    const [expanded, setExpanded] = useState(false);

    // Poll the ref at a low frequency to decouple from prefetch callbacks
    useEffect(() => {
        const id = setInterval(() => {
            const current = statsRef.current;
            if (current) {
                setStats((prev) => {
                    // Only update if something meaningful changed
                    if (
                        prev &&
                        prev.queued === current.queued &&
                        prev.loading === current.loading &&
                        prev.loaded === current.loaded &&
                        prev.errors === current.errors &&
                        prev.paused === current.paused
                    ) {
                        return prev;
                    }
                    return current;
                });
            }
        }, 500);
        return () => clearInterval(id);
    }, [statsRef]);

    if (!stats) return null;

    const isActive = stats.queued > 0 || stats.loading > 0;
    const totalPending = stats.queued + stats.loading;

    return (
        <div
            className="absolute bottom-2 left-2 z-[1000] select-none"
            onMouseEnter={() => setExpanded(true)}
            onMouseLeave={() => setExpanded(false)}
        >
            {/* Compact pill */}
            <div
                className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium shadow-sm backdrop-blur-sm transition-all duration-200 cursor-default ${
                    isActive
                        ? 'bg-white/90 text-neutral-700 border border-neutral-200'
                        : 'bg-white/70 text-neutral-400 border border-neutral-100'
                }`}
            >
                {isActive ? (
                    <>
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
                        </span>
                        <span>Prefetching {totalPending}</span>
                    </>
                ) : (
                    <>
                        <svg
                            width="10"
                            height="10"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            className="text-green-500"
                        >
                            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                        </svg>
                        <span>{stats.loaded} cached</span>
                    </>
                )}
            </div>

            {/* Expanded details on hover */}
            {expanded && (
                <div className="mt-1 bg-white/95 backdrop-blur-sm border border-neutral-200 rounded-lg shadow-lg p-2.5 min-w-[200px] text-[10px] text-neutral-600 space-y-1.5 animate-in fade-in slide-in-from-bottom-1 duration-150">
                    <div className="font-semibold text-neutral-800 text-[11px] mb-1">
                        Prefetch Details
                    </div>

                    {/* Summary row */}
                    <div className="flex justify-between border-b border-neutral-100 pb-1 mb-1">
                        <span className="text-neutral-500">Total</span>
                        <div className="flex gap-2">
                            <StatusBadge label="Q" value={stats.queued} color="amber" />
                            <StatusBadge label="L" value={stats.loading} color="blue" />
                            <StatusBadge label="✓" value={stats.loaded} color="green" />
                            {stats.errors > 0 && (
                                <StatusBadge label="✗" value={stats.errors} color="red" />
                            )}
                        </div>
                    </div>

                    {/* Per-category breakdown */}
                    <CategoryRow label="Spatial" stats={stats.spatialActive} />
                    <CategoryRow label="Background" stats={stats.bgViewport} />
                    <CategoryRow label="Next nav" stats={stats.nextNavPrimary} />
                    <CategoryRow label="Next nav BG" stats={stats.nextNavBackground} />

                    {/* Paused indicator */}
                    {stats.paused && (
                        <div className="text-amber-600 text-[9px] mt-1 flex items-center gap-1">
                            <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
                                <rect x="3" y="2" width="4" height="12" rx="1" />
                                <rect x="9" y="2" width="4" height="12" rx="1" />
                            </svg>
                            Paused (user interacting)
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ── Sub-components ──────────────────────────────────────────────────────────

interface CategoryStats {
    queued: number;
    loading: number;
    loaded: number;
    errors: number;
}

function CategoryRow({ label, stats }: { label: string; stats: CategoryStats }) {
    const total = stats.queued + stats.loading + stats.loaded + stats.errors;
    if (total === 0) return null;

    return (
        <div className="flex justify-between items-center">
            <span className="text-neutral-500">{label}</span>
            <div className="flex gap-2">
                {stats.queued > 0 && <StatusBadge label="Q" value={stats.queued} color="amber" />}
                {stats.loading > 0 && <StatusBadge label="L" value={stats.loading} color="blue" />}
                {stats.loaded > 0 && <StatusBadge label="✓" value={stats.loaded} color="green" />}
                {stats.errors > 0 && <StatusBadge label="✗" value={stats.errors} color="red" />}
                {total === 0 && <span className="text-neutral-300">—</span>}
            </div>
        </div>
    );
}

function StatusBadge({
    label,
    value,
    color,
}: {
    label: string;
    value: number;
    color: 'amber' | 'blue' | 'green' | 'red';
}) {
    const colorMap = {
        amber: 'text-amber-600',
        blue: 'text-blue-600',
        green: 'text-green-600',
        red: 'text-red-600',
    };
    return (
        <span className={`${colorMap[color]} tabular-nums`}>
            {label}{value}
        </span>
    );
}

export default memo(PrefetchStatusIndicator);
