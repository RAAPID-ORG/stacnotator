import { useState } from 'react';

// Inline the stats shape so we don't depend on a non-exported type path
interface PrefetchCategoryStats { queued: number; loading: number; loaded: number; errors: number; }
interface PrefetchStats {
    queued: number; loading: number; loaded: number; errors: number; paused: boolean;
    spatialActive: PrefetchCategoryStats;
    bgViewport: PrefetchCategoryStats;
    nextNavActive: PrefetchCategoryStats;
    nextNavBackground: PrefetchCategoryStats;
}

interface Props {
    stats: PrefetchStats | null;
}

interface CategoryRowProps {
    label: string;
    loaded: number;
    queued: number;
    loading: number;
    color: string;
}

function CategoryRow({ label, loaded, queued, loading, color }: CategoryRowProps) {
    const total = loaded + queued + loading;
    const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;

    return (
        <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-[10px]">
                <span className="text-neutral-300 font-medium">{label}</span>
                <span className="text-neutral-400 tabular-nums">
                    {loaded}/{total}
                    {loading > 0 && <span className="text-yellow-400 ml-1">↓{loading}</span>}
                </span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-700 overflow-hidden">
                <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                />
            </div>
        </div>
    );
}

export default function PrefetchStatsOverlay({ stats }: Props) {
    const [hovered, setHovered] = useState(false);

    // Total progress across all categories
    const totalLoaded = stats?.loaded ?? 0;
    const totalQueued = (stats?.queued ?? 0) + (stats?.loading ?? 0);
    const totalAll = totalLoaded + totalQueued;
    const overallPct = totalAll > 0 ? Math.round((totalLoaded / totalAll) * 100) : 100;
    const isPaused = stats?.paused ?? false;
    const hasActivity = totalAll > 0;

    return (
        <div
            className="absolute bottom-2 left-2 z-[500] select-none"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* Pill badge — always visible */}
            <div className={`
                flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium cursor-default
                backdrop-blur-sm border transition-all duration-200
                ${isPaused
                    ? 'bg-neutral-900/70 border-neutral-600/50 text-neutral-400'
                    : hasActivity
                        ? 'bg-neutral-900/70 border-blue-500/40 text-neutral-200'
                        : 'bg-neutral-900/70 border-neutral-700/40 text-neutral-500'
                }
            `}>
                {/* Status dot */}
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    isPaused ? 'bg-neutral-500' :
                    hasActivity ? 'bg-blue-400 animate-pulse' :
                    'bg-green-500'
                }`} />

                {/* Mini bar */}
                <div className="w-12 h-1 rounded-full bg-neutral-700 overflow-hidden">
                    <div
                        className="h-full rounded-full bg-blue-400 transition-all duration-300"
                        style={{ width: `${overallPct}%` }}
                    />
                </div>

                <span className="tabular-nums text-neutral-400">{overallPct}%</span>
            </div>

            {/* Hover popover */}
            {hovered && stats && (
                <div className="absolute bottom-full left-0 mb-1.5 w-52 rounded-lg bg-neutral-900/95 border border-neutral-700/60 shadow-xl backdrop-blur-sm p-3 flex flex-col gap-2.5">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-neutral-200 tracking-wide uppercase">
                            Prefetch
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                            isPaused
                                ? 'bg-neutral-700 text-neutral-400'
                                : 'bg-blue-900/60 text-blue-300'
                        }`}>
                            {isPaused ? 'Paused' : 'Active'}
                        </span>
                    </div>

                    {/* Overall */}
                    <div className="flex flex-col gap-0.5">
                        <div className="flex items-center justify-between text-[10px]">
                            <span className="text-neutral-300 font-medium">Overall</span>
                            <span className="text-neutral-400 tabular-nums">{totalLoaded} loaded</span>
                        </div>
                        <div className="h-2 rounded-full bg-neutral-700 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-blue-400 transition-all duration-300"
                                style={{ width: `${overallPct}%` }}
                            />
                        </div>
                    </div>

                    <div className="border-t border-neutral-700/50 my-0.5" />

                    {/* Per-category rows */}
                    <CategoryRow
                        label="Spatial (active)"
                        loaded={stats.spatialActive.loaded}
                        queued={stats.spatialActive.queued}
                        loading={stats.spatialActive.loading}
                        color="#60a5fa"
                    />
                    <CategoryRow
                        label="Background layers"
                        loaded={stats.bgViewport.loaded}
                        queued={stats.bgViewport.queued}
                        loading={stats.bgViewport.loading}
                        color="#a78bfa"
                    />
                    <CategoryRow
                        label="Next nav (active)"
                        loaded={stats.nextNavActive.loaded}
                        queued={stats.nextNavActive.queued}
                        loading={stats.nextNavActive.loading}
                        color="#34d399"
                    />
                    <CategoryRow
                        label="Next nav (bg)"
                        loaded={stats.nextNavBackground.loaded}
                        queued={stats.nextNavBackground.queued}
                        loading={stats.nextNavBackground.loading}
                        color="#6ee7b7"
                    />

                    {/* Error count if any */}
                    {stats.errors > 0 && (
                        <div className="text-[9px] text-red-400 border-t border-neutral-700/50 pt-1.5">
                            ⚠ {stats.errors} tile error{stats.errors !== 1 ? 's' : ''}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
