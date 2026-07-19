import { useEffect, useMemo, useRef, useState } from 'react';
import ReactGridLayout, { getCompactor, type Layout, type LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import ImageryContainer from './ImageryContainer';
import { WindowSliceSelect } from './WindowSliceSelect';
import MiniMap from './Minimap';
import { LocationSearch } from './LocationSearch';
import MainAnnotationsContainer from './MainAnnotationContainer';
import { TimeSeriesChart } from './TimeSeries/TimeSeriesChart';
import ControlsTaskMode from './ControlsTaskMode';
import ControlsOpenMode from './ControlsOpenMode';
import { useCampaignStore } from '../stores/campaign.store';
import { useAnnotationStore } from '../stores/annotation.store';
import { useTaskStore } from '../stores/task.store';
import { useMapStore } from '../stores/map.store';
import { getAnnotationDensity, type AnnotationDensityCell } from '~/api/client';
import { extractCentroidFromWKT, type LatLon } from '~/shared/utils/utility';
import { useLayoutStore } from '~/features/layout/layout.store';
import { useContainerWidth } from '../hooks/useContainerWidth';
import { handleError } from '~/shared/utils/errorHandler';
import { useIsMobile } from '~/shared/utils/useIsMobile';
import { byCollectionDate } from '../utils/collectionOrder';
import { isTimeseriesWindowKey } from '../utils/layoutDefaults';
import { groupTimeseriesIntoWindows, type TimeseriesWindow } from '../utils/timeseriesWindows';
import { getActiveClaim, UNASSIGNED } from '../utils/taskFilter';
import { useAccountStore } from '~/features/account/account.store';
import { HiddenWindowsPanel } from './HiddenWindowsPanel';
import { WindowDropController } from './WindowDropController';
import { IconClose, IconExternalLink, IconEyeSlash } from '~/shared/ui/Icons';
import { PopoutWindow, type PopoutBounds } from '~/shared/ui/PopoutWindow';
import { PopoutScreen, type ScreenCard } from './PopoutScreen';
import { usePopoutStore } from '../stores/popout.store';
import { mergeLayoutChange, scaleWidthToScreen, withoutKeys } from '../utils/popoutLayout';

// A single stable compactor instance - recreating it per render would
// invalidate react-grid-layout's internal memos that key on its identity.
const CANVAS_COMPACTOR = getCompactor(null, false, true);
const RESIZE_HANDLES = ['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne'] as const;

// Renew interval for a held claim; TTL/3, well inside the backend 30 min TTL.
const CLAIM_RENEW_MS = 10 * 60 * 1000;

// Initial OS-window size for a newly opened screen; the store remembers the
// user's size/position per screen for the rest of the session.
const SCREEN_DEFAULT_BOUNDS: PopoutBounds = { width: 1280, height: 860 };
// Rough horizontal overhead of a screen window (scrollbar + canvas padding),
// used to estimate its canvas width before the window has reported one.
const SCREEN_CHROME_PX = 40;

/** Card-header control that sends a canvas card to a secondary screen
 *  window. With no screen open a click opens the first one directly; with
 *  screens open it offers the existing screens plus "New screen". Lives
 *  inside each card's header so it never overlaps card content. */
const SendToScreenButton = ({
  cardKey,
  label,
  onSend,
  darkBg = false,
  revealClass = 'opacity-0 group-hover/card:opacity-100',
  className = '',
}: {
  cardKey: string;
  label: string;
  onSend: (target: number | 'new') => void;
  darkBg?: boolean;
  revealClass?: string;
  className?: string;
}) => {
  const screens = usePopoutStore((s) => s.screens);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const send = (target: number | 'new') => {
    setMenuOpen(false);
    onSend(target);
  };

  return (
    <div ref={wrapRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (screens.length === 0) send('new');
          else setMenuOpen((open) => !open);
        }}
        title={`Move ${label} to another screen`}
        aria-label={`Move ${label} to another screen`}
        data-testid={`send-to-screen-${cardKey}`}
        className={`grid h-5 w-5 place-items-center rounded transition-colors focus-visible:opacity-100 ${
          darkBg
            ? 'text-white/70 hover:bg-white/10 hover:text-white'
            : 'text-neutral-400 hover:bg-neutral-100 hover:text-brand-600'
        } ${menuOpen ? 'opacity-100' : revealClass}`}
      >
        <IconExternalLink className="h-3.5 w-3.5" />
      </button>
      {menuOpen && (
        // z above Leaflet's panes/controls (~1000) so the menu isn't painted
        // under the minimap; the RGL item's transform keeps this context local.
        <div className="absolute right-0 top-6 z-[1001] w-36 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
          {screens.map((id) => (
            <button
              key={id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                send(id);
              }}
              data-testid={`send-to-screen-${cardKey}-${id}`}
              className="block w-full px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-50"
            >
              Screen {id}
            </button>
          ))}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              send('new');
            }}
            data-testid={`send-to-screen-${cardKey}-new`}
            className="block w-full border-t border-neutral-100 px-3 py-1.5 text-left text-xs font-medium text-brand-700 hover:bg-brand-50"
          >
            New screen
          </button>
        </div>
      )}
    </div>
  );
};

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    handleError(err, 'Failed to copy to clipboard', { showUser: false });
  }
};

interface CanvasProps {
  commentInputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export const Canvas = ({ commentInputRef }: CanvasProps) => {
  const { containerRef, containerWidth, containerHeight, isMounted } = useContainerWidth();
  const headerControlsRef = useRef<HTMLDivElement>(null);
  const gridInnerRef = useRef<HTMLDivElement>(null);
  // Pointer-down position on a window's hide button, so a drag-to-move (which
  // also starts on the body) isn't mistaken for a hide click on release.
  const hideDownRef = useRef<{ x: number; y: number } | null>(null);
  const isMobile = useIsMobile();

  const campaign = useCampaignStore((s) => s.campaign);
  const workMode = useCampaignStore((s) => s.workMode);
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);
  const isEditingLayout = useCampaignStore((s) => s.isEditingLayout);
  const currentLayout = useCampaignStore((s) => s.currentLayout);
  const setCurrentLayout = useCampaignStore((s) => s.setCurrentLayout);
  const hideWindow = useCampaignStore((s) => s.hideWindow);

  const screens = usePopoutStore((s) => s.screens);
  const assignment = usePopoutStore((s) => s.assignment);
  const sendCard = usePopoutStore((s) => s.sendCard);
  const closeScreen = usePopoutStore((s) => s.closeScreen);
  const rememberBounds = usePopoutStore((s) => s.rememberBounds);
  const lastBounds = usePopoutStore((s) => s.lastBounds);
  const savedScreens = usePopoutStore((s) => (s.activeKey ? (s.saved[s.activeKey] ?? null) : null));
  const restoreSaved = usePopoutStore((s) => s.restoreSaved);
  const clearSaved = usePopoutStore((s) => s.clearSaved);

  const allTasks = useTaskStore((s) => s.allTasks);
  const visibleTasks = useTaskStore((s) => s.visibleTasks);
  const taskFilter = useTaskStore((s) => s.taskFilter);
  const currentTaskIndex = useTaskStore((s) => s.currentTaskIndex);
  const isSubmitting = useTaskStore((s) => s.isSubmitting);
  const submitAnnotation = useTaskStore((s) => s.submitAnnotation);
  const nextTask = useTaskStore((s) => s.nextTask);
  const previousTask = useTaskStore((s) => s.previousTask);
  const goToTask = useTaskStore((s) => s.goToTask);
  const claimCurrentTask = useTaskStore((s) => s.claimCurrentTask);

  const currentUserId = useAccountStore((s) => s.account?.id);

  // Scope the persisted screen configuration to this user+campaign.
  const campaignId = campaign?.id;
  useEffect(() => {
    if (campaignId == null || currentUserId == null || isMobile) return;
    usePopoutStore.getState().setActiveKey(`${currentUserId}:${campaignId}`);
  }, [campaignId, currentUserId, isMobile]);

  const activeCollectionId = useMapStore((s) => s.activeCollectionId);
  const activeSliceIndex = useMapStore((s) => s.activeSliceIndex);
  const selectedLayerIndex = useMapStore((s) => s.selectedLayerIndex);
  const showBasemap = useMapStore((s) => s.showBasemap);
  const selectedBasemapId = useMapStore((s) => s.selectedBasemapId);
  // Only explore reads these; subscribing in tasks mode would re-render the
  // whole grid every motion frame for nothing.
  const currentMapBounds = useMapStore((s) => (workMode === 'explore' ? s.currentMapBounds : null));
  const currentMapCenter = useMapStore((s) => (workMode === 'explore' ? s.currentMapCenter : null));
  const triggerPanToCenter = useMapStore((s) => s.triggerPanToCenter);
  const triggerSearchFocus = useMapStore((s) => s.triggerSearchFocus);
  const timeseriesPoint = useMapStore((s) => s.timeseriesPoint);
  const probeTimeseriesPoint = useMapStore((s) => s.probeTimeseriesPoint);
  const setActiveCollectionId = useMapStore((s) => s.setActiveCollectionId);

  const isFullscreen = useLayoutStore((state) => state.isFullscreen);

  const currentTask = visibleTasks[currentTaskIndex] || null;

  // Claim on arrival and renew while the user stays. The store no-ops for
  // assigned/worked/review tasks, and claiming the next task releases this one.
  const currentTaskId = currentTask?.id ?? null;
  useEffect(() => {
    if (workMode !== 'tasks' || currentTaskId == null) return;
    void claimCurrentTask();
    const renew = setInterval(() => void claimCurrentTask(), CLAIM_RENEW_MS);
    return () => clearInterval(renew);
  }, [workMode, currentTaskId, claimCurrentTask]);

  // Counter scope: assignedTo filter only, ignoring the status filter so the
  // progress number reflects the user's full workload, not the filtered view.
  const { totalTasksForCounter, completedTasksForCounter } = useMemo(() => {
    const tasksInAssignmentScope = allTasks.filter((task) => {
      if (taskFilter.assignedTo.length === 0) return true;
      const assignments = task.assignments || [];
      if (taskFilter.assignedTo.includes(UNASSIGNED) && assignments.length === 0) return true;
      return assignments.some((a) => taskFilter.assignedTo.includes(a.user_id));
    });
    return {
      totalTasksForCounter: tasksInAssignmentScope.length,
      completedTasksForCounter: tasksInAssignmentScope.filter(
        (task) =>
          task.task_status === 'done' ||
          task.task_status === 'skipped' ||
          task.task_status === 'conflicting'
      ).length,
    };
  }, [allTasks, taskFilter.assignedTo]);

  const selectedView = campaign?.imagery_views?.find((v) => v.id === selectedViewId) ?? null;
  const isOpenMode = workMode === 'explore';
  const campaignBbox = campaign
    ? ([
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
      ] as [number, number, number, number])
    : null;

  // Minimap annotation overview: the client no longer holds every annotation
  // (viewport vector tiling), so we fetch a coarse server-aggregated density
  // grid and show it as indicators. Refetched when annotations change
  // (tileVersion bump) so the overview tracks edits.
  const tileVersion = useAnnotationStore((s) => s.tileVersion);
  const [annotationDensity, setAnnotationDensity] = useState<AnnotationDensityCell[]>([]);
  const [searchExpanded, setSearchExpanded] = useState(false);
  useEffect(() => {
    if (workMode !== 'explore' || campaign?.id == null) {
      setAnnotationDensity([]);
      return;
    }
    let cancelled = false;
    void getAnnotationDensity({ path: { campaign_id: campaign.id } })
      .then((res) => {
        if (!cancelled) setAnnotationDensity(res.data ?? []);
      })
      .catch(() => {
        /* minimap overview is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [campaign?.id, workMode, tileVersion]);

  const windowCollections = useMemo(() => {
    if (!campaign || !selectedView) return [];
    // A collection appears in the grid only if it's eligible at the view level
    // (`show_as_window=true`) AND present in the user's current layout. The
    // layout membership is the per-user hide/show lever; the view flag is the
    // admin-level eligibility gate.
    const layoutKeys = new Set((currentLayout ?? []).map((it) => it.i));
    return selectedView.collection_refs
      .filter((ref) => ref.show_as_window)
      .filter((ref) => layoutKeys.has(String(ref.collection_id)))
      .map((ref) => {
        const source = campaign.imagery_sources.find((s) => s.id === ref.source_id);
        const collection = source?.collections.find((c) => c.id === ref.collection_id);
        return { ...ref, collection, source };
      })
      .filter((r) => r.collection && r.source)
      .sort(byCollectionDate);
  }, [campaign, selectedView, currentLayout]);

  // Timeseries split into one canvas window per distinct window_name; unnamed
  // series share the default window. Each window renders its own chart.
  const timeseriesWindows = useMemo<TimeseriesWindow[]>(
    () => groupTimeseriesIntoWindows(campaign?.time_series ?? []),
    [campaign?.time_series]
  );

  // Every per-window chart fetches this full set (then renders only its window's
  // series) so the coordinate-keyed cache holds all series at a point and dedups
  // across windows, instead of each window fetching a disjoint subset. Memoized
  // for a stable identity so it doesn't retrigger the charts' fetch effects.
  const allTimeseriesIds = useMemo(
    () => (campaign?.time_series ?? []).map((ts) => ts.id),
    [campaign?.time_series]
  );

  // On mobile we ignore the saved desktop layout and stack everything in a
  // single column. Main + controls share the visible viewport (same height);
  // timeseries / minimap / windows follow below the fold.
  const ROW_HEIGHT = 15;
  const mobileLayout = useMemo<Layout>(() => {
    if (!campaign) return [];
    const halfRows = Math.max(20, Math.floor(containerHeight / ROW_HEIGHT / 2));
    const restRows = 18;
    const items: LayoutItem[] = [];
    let y = 0;
    items.push({ i: 'main', x: 0, y, w: 60, h: halfRows });
    y += halfRows;
    items.push({ i: 'controls', x: 0, y, w: 60, h: halfRows });
    y += halfRows;
    for (const tw of timeseriesWindows) {
      items.push({ i: tw.key, x: 0, y, w: 60, h: restRows });
      y += restRows;
    }
    items.push({ i: 'minimap', x: 0, y, w: 60, h: restRows });
    y += restRows;
    for (const wc of windowCollections) {
      items.push({ i: String(wc.collection_id), x: 0, y, w: 60, h: restRows });
      y += restRows;
    }
    return items;
  }, [campaign, containerHeight, windowCollections, timeseriesWindows]);

  // Screens are a desktop affordance; mobile keeps its fixed stacked layout.
  const popped = useMemo(
    () => new Set(isMobile ? [] : Object.keys(assignment)),
    [isMobile, assignment]
  );

  const effectiveLayout = isMobile
    ? mobileLayout
    : currentLayout && withoutKeys(currentLayout, popped);

  // The grid reports layout changes without the sent-away cards; keep their
  // remembered slots in currentLayout so saving and returning both work.
  // Reads both stores at call time: react-grid-layout may invoke a callback
  // captured on an earlier render, and a stale `popped` here would silently
  // drop a sent-away card from the layout.
  const handleLayoutChange = (next: Layout) => {
    const previous = useCampaignStore.getState().currentLayout;
    const poppedNow = new Set(Object.keys(usePopoutStore.getState().assignment));
    setCurrentLayout(mergeLayoutChange(next, previous, poppedNow));
  };

  // Keep the card's PIXEL size when it moves: rows are fixed-height so h
  // transfers as-is, but a grid column is narrower in a smaller screen
  // window, so convert w using the two canvas widths.
  const sendToScreen = (key: string, target: number | 'new') => {
    const item = (useCampaignStore.getState().currentLayout ?? []).find((it) => it.i === key);
    if (!item) {
      sendCard(key, target);
      return;
    }
    const { screenWidths, lastBounds: bounds } = usePopoutStore.getState();
    const screenPx =
      target === 'new'
        ? SCREEN_DEFAULT_BOUNDS.width - SCREEN_CHROME_PX
        : (screenWidths[target] ??
          (bounds[target]?.width ?? SCREEN_DEFAULT_BOUNDS.width) - SCREEN_CHROME_PX);
    sendCard(key, target, {
      w: scaleWidthToScreen(item.w, containerWidth, screenPx),
      h: item.h,
    });
  };

  // A sent-away card can disappear from under us (view switch removes its
  // collection, campaign settings drop the time series): return it.
  useEffect(() => {
    const keys = Object.keys(assignment);
    if (keys.length === 0) return;
    const valid = new Set(['controls', 'minimap']);
    for (const tw of timeseriesWindows) valid.add(tw.key);
    for (const wc of windowCollections) valid.add(String(wc.collection_id));
    for (const key of keys) {
      if (!valid.has(key)) sendCard(key, null);
    }
  }, [assignment, timeseriesWindows, windowCollections, sendCard]);

  // react-grid-layout memoizes against the *identity* of these config props, so
  // keep them stable across renders to avoid needlessly re-firing its effects.
  const editing = isEditingLayout && !isMobile;
  const gridConfig = useMemo(
    () => ({
      cols: 60,
      rowHeight: ROW_HEIGHT,
      margin: (isMobile ? [0, 0] : [6, 6]) as [number, number],
    }),
    [isMobile]
  );
  const dragConfig = useMemo(() => ({ enabled: editing }), [editing]);
  const resizeConfig = useMemo(
    () => ({ enabled: editing, handles: [...RESIZE_HANDLES] }),
    [editing]
  );

  const activeSource = useMemo(() => {
    if (!campaign || !activeCollectionId) return null;
    return (
      campaign.imagery_sources.find((s) =>
        s.collections.some((c) => c.id === activeCollectionId)
      ) ?? null
    );
  }, [campaign, activeCollectionId]);

  const activeCollection = useMemo(
    () => activeSource?.collections.find((c) => c.id === activeCollectionId) ?? null,
    [activeSource, activeCollectionId]
  );
  const activeSlice = activeCollection?.slices[activeSliceIndex] ?? null;

  const activeSourceVizName = useMemo(() => {
    if (!activeSource || !campaign) return null;
    let offset = 0;
    for (const s of campaign.imagery_sources) {
      if (s.id === activeSource.id) break;
      offset += s.visualizations.length;
    }
    const idx = Math.max(0, selectedLayerIndex - offset);
    return (
      activeSource.visualizations[Math.min(idx, activeSource.visualizations.length - 1)]?.name ??
      null
    );
  }, [activeSource, campaign, selectedLayerIndex]);

  // Own memo (geometry-only deps) so its reference stays stable across pans.
  const taskCentroid = useMemo<LatLon | null>(
    () => (currentTask ? extractCentroidFromWKT(currentTask.geometry.geometry) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTask?.geometry.geometry]
  );

  // Open mode: map center. Task mode: the (stable) task centroid.
  const focusPoint = useMemo<LatLon | null>(() => {
    if (isOpenMode) {
      if (currentMapCenter) return { lat: currentMapCenter[0], lon: currentMapCenter[1] };
      return null;
    }
    return taskCentroid;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpenMode, currentMapCenter?.[0], currentMapCenter?.[1], taskCentroid]);

  // Open mode only sends a timeseries point when explicitly clicked with the
  // timeseries tool; task mode always uses the task centroid.
  const timeseriesLatLon = useMemo<LatLon | null>(() => {
    if (isOpenMode) return timeseriesPoint;
    return focusPoint;
  }, [isOpenMode, timeseriesPoint, focusPoint]);

  const center = useMemo<[number, number]>(
    () => (focusPoint ? [focusPoint.lat, focusPoint.lon] : [0, 0]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusPoint?.lat, focusPoint?.lon]
  );

  if (!campaign) return null;

  const renderMainHeader = () => {
    const activeClaim = currentTask ? getActiveClaim(currentTask) : null;
    const claimedByMe = activeClaim?.user_id === currentUserId;
    return (
      <div className="flex items-center justify-between gap-3 w-full">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          {!isOpenMode && currentTask ? (
            <span className="-ml-2.5 w-[60px] shrink-0 text-center text-xs font-semibold text-neutral-900 tabular-nums">
              {currentTask.annotation_number}
            </span>
          ) : (
            <span className="text-xs font-medium text-neutral-700 truncate">
              {showBasemap
                ? (campaign.basemaps.find((b) => `basemap-${b.id}` === selectedBasemapId)?.name ??
                  'Basemap')
                : activeSourceVizName || 'Layer'}
            </span>
          )}
          {!isOpenMode && activeClaim && (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                claimedByMe ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {claimedByMe
                ? 'Claimed by you'
                : `Claimed by ${activeClaim.user_display_name || activeClaim.user_email || 'another user'}`}
            </span>
          )}
        </div>

        {/* Slot for map controls (selectors + actions), filled via portal from MainAnnotationContainer */}
        <div
          ref={headerControlsRef}
          className="flex items-center gap-2 min-w-0 flex-1 justify-end"
          data-tour="map-controls"
        />

        {!isOpenMode ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-neutral-500">
              <span className="font-semibold text-neutral-900 tabular-nums">
                {completedTasksForCounter}
              </span>{' '}
              of <span className="tabular-nums">{totalTasksForCounter}</span> done
            </span>
          </div>
        ) : (
          !showBasemap &&
          activeSource && (
            <span className="text-[11px] text-neutral-500 truncate shrink-0">
              {activeSource.name}
              {activeSlice && ` · ${activeSlice.name}`}
            </span>
          )
        )}
      </div>
    );
  };

  const renderMinimapHeader = (withSendButton = false) => (
    <div className="flex items-center gap-2 w-full min-w-0">
      {!searchExpanded &&
        (focusPoint ? (
          <span className="tabular-nums text-xs text-neutral-700 font-medium truncate">
            {focusPoint.lat.toFixed(5)}, {focusPoint.lon.toFixed(5)}
          </span>
        ) : (
          <span className="text-[11px] text-neutral-400 italic">no position</span>
        ))}
      <div
        className={`flex items-center gap-0.5 min-w-0 ${searchExpanded ? 'flex-1' : 'ml-auto shrink-0'}`}
      >
        {!searchExpanded && focusPoint && (
          <>
            <button
              onClick={() => copyToClipboard(`${focusPoint.lat},${focusPoint.lon}`)}
              className="p-1 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
              title="Copy coordinates to clipboard"
            >
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
              </svg>
            </button>
            <a
              href={`https://earth.google.com/web/search/${focusPoint.lat},${focusPoint.lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
              title="Open in Google Earth"
              onClick={(e) => e.stopPropagation()}
              data-tour="open-in-google-earth"
            >
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
              </svg>
            </a>
          </>
        )}
        <LocationSearch
          expanded={searchExpanded}
          onExpandedChange={setSearchExpanded}
          onSelect={(result) => triggerSearchFocus(result.center, result.extent)}
          className={searchExpanded ? 'w-full' : ''}
        />
        {withSendButton && showPopoutButtons && !searchExpanded && (
          <SendToScreenButton
            cardKey="minimap"
            label="the location minimap"
            onSend={(target) => sendToScreen('minimap', target)}
          />
        )}
      </div>
    </div>
  );

  // Sending cards to screens is a layout decision, so it lives in edit mode
  // (like hiding windows); the split persists per user, so it's a one-time
  // setup rather than an every-session chore.
  const showPopoutButtons = !isMobile && isEditingLayout;

  // Screens cannot reopen automatically after a reload (browsers require a
  // user gesture per popup), so offer the saved split back with one click.
  const restorableCount =
    !isMobile &&
    screens.length === 0 &&
    savedScreens &&
    Object.keys(savedScreens.assignment).length > 0
      ? savedScreens.screens.length
      : 0;

  // Card bodies are defined once and rendered either as a grid child or into
  // a pop-out window - never both - so component state and maps stay intact
  // in whichever window currently hosts them.
  const controlsBody = (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      {workMode === 'tasks' ? (
        <ControlsTaskMode
          labels={campaign.settings.labels}
          onSubmit={submitAnnotation}
          onNext={nextTask}
          onPrevious={previousTask}
          onGoToTask={goToTask}
          isSubmitting={isSubmitting}
          totalTasksCount={visibleTasks.length}
          currentTask={currentTask}
          commentInputRef={commentInputRef}
        />
      ) : (
        <ControlsOpenMode />
      )}
    </div>
  );

  const timeseriesPrefetch = visibleTasks
    .slice(currentTaskIndex + 1, currentTaskIndex + 4)
    .map((task) => extractCentroidFromWKT(task.geometry.geometry))
    .filter((coord): coord is LatLon => coord !== null);

  const renderTimeseriesBody = (series: typeof campaign.time_series) => (
    <TimeSeriesChart
      timeseries={series}
      fetchIds={allTimeseriesIds}
      latLon={timeseriesLatLon}
      prefetchCoordinates={timeseriesPrefetch}
      probeLatLon={!isOpenMode ? probeTimeseriesPoint : undefined}
    />
  );

  const minimapBody = (
    <MiniMap
      center={center}
      bbox={campaignBbox || [0, 0, 0, 0]}
      visibleBounds={workMode === 'explore' ? currentMapBounds : null}
      onViewportDrag={
        workMode === 'explore' ? (lat, lon) => triggerPanToCenter([lat, lon]) : undefined
      }
      fitBbox={workMode === 'tasks'}
      annotationDensity={annotationDensity}
    />
  );

  const cardDefFor = (key: string): ScreenCard | null => {
    if (key === 'controls') return { key, title: 'Controls', body: controlsBody };
    if (isTimeseriesWindowKey(key)) {
      const tw = timeseriesWindows.find((w) => w.key === key);
      return tw ? { key, title: tw.title, body: renderTimeseriesBody(tw.series) } : null;
    }
    if (key === 'minimap')
      return { key, title: 'Location', headerContent: renderMinimapHeader(), body: minimapBody };
    const wc = windowCollections.find((w) => String(w.collection_id) === key);
    if (!wc?.collection || !wc.source) return null;
    const { collection, source } = wc;
    const isActiveCol = collection.id === activeCollectionId;
    return {
      key,
      title: collection.name,
      headerClassName: `!py-0.5 !gap-2 hover:bg-neutral-50 ${isActiveCol ? '!bg-brand-600 !text-white !border-b-brand-600' : ''}`,
      onHeaderClick: () => setActiveCollectionId(collection.id),
      headerContent: (
        <>
          <span className="min-w-0 flex-1 truncate" title={`${source.name} - ${collection.name}`}>
            {collection.name}
          </span>
          <WindowSliceSelect collection={collection} darkBg={isActiveCol} />
        </>
      ),
      body: <ImageryContainer collectionId={collection.id} sourceId={source.id} />,
    };
  };

  const screenCardsFor = (screenId: number): ScreenCard[] =>
    Object.entries(assignment)
      .filter(([, sid]) => sid === screenId)
      .map(([key]) => cardDefFor(key))
      .filter((c): c is ScreenCard => c !== null);

  return (
    <main
      ref={containerRef}
      className={`flex-1 min-h-0 relative bg-base overflow-y-auto overflow-x-hidden ${isMobile ? 'p-0' : isFullscreen! ? 'p-3' : 'p-1'} ${
        isEditingLayout ? 'is-editing' : ''
      }`}
    >
      {isMounted && effectiveLayout && (
        <ReactGridLayout
          width={containerWidth}
          innerRef={gridInnerRef}
          layout={effectiveLayout}
          gridConfig={gridConfig}
          dragConfig={dragConfig}
          resizeConfig={resizeConfig}
          compactor={CANVAS_COMPACTOR}
          onLayoutChange={isMobile ? undefined : handleLayoutChange}
        >
          <div key="main" className="grid-card" data-tour="main-map">
            <div className={`drag-handle card-header ${isEditingLayout ? 'editable' : ''}`}>
              {renderMainHeader()}
            </div>
            <MainAnnotationsContainer
              commentInputRef={commentInputRef}
              headerSlotRef={headerControlsRef}
            />
          </div>

          {timeseriesWindows.map((tw, idx) =>
            popped.has(tw.key) ? null : (
              <div
                key={tw.key}
                className="grid-card group/card"
                // Keep the guided tour's single timeseries anchor on the first window.
                {...(idx === 0 ? { 'data-tour': 'timeseries' } : {})}
                data-timeseries-window-key={tw.key}
              >
                <div className={`drag-handle card-header ${isEditingLayout ? 'editable' : ''}`}>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                    {tw.title}
                  </span>
                  {showPopoutButtons && (
                    <SendToScreenButton
                      cardKey={tw.key}
                      label={`the ${tw.title} chart`}
                      onSend={(target) => sendToScreen(tw.key, target)}
                    />
                  )}
                </div>
                {renderTimeseriesBody(tw.series)}
              </div>
            )
          )}

          {!popped.has('minimap') && (
            <div
              key="minimap"
              className="grid-card group/card"
              data-tour="minimap"
              data-center-lat={center[0]}
              data-center-lon={center[1]}
            >
              <div className={`drag-handle card-header ${isEditingLayout ? 'editable' : ''}`}>
                {renderMinimapHeader(true)}
              </div>
              {minimapBody}
            </div>
          )}

          {!popped.has('controls') && (
            <div key="controls" className="grid-card group/card" data-tour="controls">
              <div className={`drag-handle card-header ${isEditingLayout ? 'editable' : ''}`}>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                  Controls
                </span>
                {showPopoutButtons && (
                  <SendToScreenButton
                    cardKey="controls"
                    label="the annotation controls"
                    onSend={(target) => sendToScreen('controls', target)}
                  />
                )}
              </div>
              {controlsBody}
            </div>
          )}

          {windowCollections.map(({ collection, source }, idx) => {
            if (!collection || !source) return null;
            if (popped.has(String(collection.id))) return null;
            const isActiveCol = collection.id === activeCollectionId;

            return (
              <div
                key={collection.id}
                data-window-collection-id={collection.id}
                className={`grid-card grid-card-hoverable relative group/card ${isActiveCol ? 'active-window' : ''}`}
                {...(idx === 0 ? { 'data-tour': 'imagery-windows' } : {})}
              >
                <div
                  className={`drag-handle card-header !py-0.5 !gap-2 group/header ${isEditingLayout ? 'editable' : ''} cursor-pointer hover:bg-neutral-50 ${isActiveCol ? '!bg-brand-600 !text-white !border-b-brand-600' : ''}`}
                  onClick={() => setActiveCollectionId(collection.id)}
                  title={`${source.name} - ${collection.name}`}
                >
                  <span className="truncate flex-1 min-w-0">
                    <span
                      className={`hidden group-hover/header:inline ${isActiveCol ? 'text-white/70' : 'text-neutral-400'}`}
                    >
                      {source.name}
                      <span className="mx-1">›</span>
                    </span>
                    {collection.name}
                  </span>
                  <WindowSliceSelect collection={collection} darkBg={isActiveCol} />
                  {showPopoutButtons && (
                    <SendToScreenButton
                      cardKey={String(collection.id)}
                      label={collection.name}
                      darkBg={isActiveCol}
                      revealClass="opacity-0 group-hover/header:opacity-100"
                      onSend={(target) => sendToScreen(String(collection.id), target)}
                    />
                  )}
                </div>
                {isEditingLayout && !isMobile ? (
                  // While editing we skip the (expensive) map and turn the whole
                  // window body into a large hide target, so rearranging stays
                  // smooth and hiding is a single easy click.
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      hideDownRef.current = { x: e.clientX, y: e.clientY };
                    }}
                    onClick={(e) => {
                      // Only hide on a genuine click; if the pointer moved, it
                      // was a drag-to-reposition, so leave the window in place.
                      const down = hideDownRef.current;
                      hideDownRef.current = null;
                      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
                      hideWindow(collection.id);
                    }}
                    title={`Hide ${collection.name} (re-add it from the Hidden panel)`}
                    aria-label={`Hide ${collection.name}`}
                    className="group/hide flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-2 text-neutral-400 transition-colors hover:bg-red-50/60 hover:text-red-600"
                  >
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-neutral-100 transition-colors group-hover/hide:bg-red-100">
                      <IconEyeSlash className="h-6 w-6" />
                    </span>
                    <span className="text-xs font-medium">Hide window</span>
                  </button>
                ) : (
                  <ImageryContainer collectionId={collection.id} sourceId={source.id} />
                )}
              </div>
            );
          })}
        </ReactGridLayout>
      )}

      {!isMobile &&
        screens.map((id) => (
          <PopoutWindow
            key={id}
            title={`Screen ${id}`}
            closeLabel="Close screen"
            bounds={lastBounds[id] ?? SCREEN_DEFAULT_BOUNDS}
            onUserClose={() => closeScreen(id)}
            onBounds={(b) => rememberBounds(id, b)}
            onBlocked={() =>
              useLayoutStore
                .getState()
                .showAlert(
                  'The browser blocked the screen window. Allow popups for this site and try again.',
                  'error'
                )
            }
          >
            <PopoutScreen screenId={id} cards={screenCardsFor(id)} />
          </PopoutWindow>
        ))}

      {editing && (
        <WindowDropController
          gridRef={gridInnerRef}
          scrollRef={containerRef}
          containerWidth={containerWidth}
          rowHeight={ROW_HEIGHT}
        />
      )}
      {!isMobile && <HiddenWindowsPanel />}

      {restorableCount > 0 && !isEditingLayout && (
        <div className="fixed bottom-3 right-3 z-[1002] flex items-center gap-1 rounded-full border border-neutral-200 bg-white/95 py-1 pl-1 pr-1.5 shadow-lg ring-1 ring-black/5 backdrop-blur">
          <button
            type="button"
            onClick={restoreSaved}
            data-testid="restore-screens"
            className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
            title="Reopen your saved screen windows with their panels"
          >
            <IconExternalLink className="h-3.5 w-3.5 text-brand-600" />
            Restore {restorableCount === 1 ? 'screen' : `${restorableCount} screens`}
          </button>
          <button
            type="button"
            onClick={clearSaved}
            data-testid="dismiss-saved-screens"
            aria-label="Forget saved screens"
            title="Forget the saved screen split"
            className="grid h-6 w-6 place-items-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
          >
            <IconClose className="h-3 w-3" />
          </button>
        </div>
      )}
    </main>
  );
};
