import { useEffect, useMemo, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import { getSharedVisualizer, getVisualizerTilerToken, type VisualizerViewOut } from '~/api/client';
import { ensureTilerSession, setTilerSessionMinter } from '~/api/tilerToken';
import { Camera } from '~/shared/map/Camera';
import { MapView } from '~/shared/map/MapView';
import type { GeocodingResult } from '~/shared/map/geocoding';
import type { Bbox } from '~/shared/map/types';
import { Badge } from '~/shared/ui/Badge';
import { Button } from '~/shared/ui/forms';
import { HarvestMark, HARVEST_SITE } from '~/shared/ui/HarvestMark';
import {
  IconChevronDoubleLeft,
  IconCheck,
  IconComment,
  IconCopy,
  IconMap,
} from '~/shared/ui/Icons';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { visualizerUrl } from './route';
import { FeedbackPanel } from './viewer/FeedbackPanel';
import { TimeSlider } from './viewer/TimeSlider';
import { ViewerSidebar } from './viewer/ViewerSidebar';
import {
  activeSource,
  composeLayers,
  initialState,
  needsTilerSession,
  selectStep,
  workingZoom,
  zoomedPastArea,
  type ViewerState,
} from './viewerState';

const WORLD = { center: [0, 20] as [number, number], zoom: 2 };
const AREA_PADDING_PX = 24;

/**
 * A visualizer, full screen and on its own.
 *
 * Mounted above the app shell (see `main.tsx`) because a published visualizer
 * has to open for someone with no account, and everything else in the app is
 * behind the login gate.
 */
export function VisualizerPage({ slug }: { slug: string }) {
  const [view, setView] = useState<VisualizerViewOut | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [state, setState] = useState<ViewerState | null>(null);
  // On a touch device the panel covers the map, so it starts out of the way.
  // Same test the `desktop:` variant makes.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
  const camera = useRef<Camera>(null);
  camera.current ??= new Camera(WORLD);
  const [feedback, setFeedback] = useState<FeedbackMode>(null);

  const frameArea = (animateMs?: number) => {
    const area = view?.area;
    if (!area) return;
    camera.current?.fitBounds([area.west, area.south, area.east, area.north], {
      paddingPx: AREA_PADDING_PX,
      minZoom: workingZoom(view),
      animateMs,
    });
  };

  /** Jump to a searched place, never further out than the imagery is worth. */
  const goTo = (result: GeocodingResult) => {
    if (!view) return;
    const floor = workingZoom(view);
    if (result.extent) {
      camera.current?.fitBounds(result.extent, {
        paddingPx: AREA_PADDING_PX,
        minZoom: floor,
        animateMs: 300,
      });
      return;
    }
    camera.current?.moveTo({ center: result.center, zoom: floor }, { animateMs: 300 });
  };

  useEffect(() => {
    // Tiles for this page are authorized by the visualizer, not by whoever is
    // looking at it, so the whole page runs on that session.
    setTilerSessionMinter(async () => {
      const { data } = await getVisualizerTilerToken({ path: { slug } });
      if (!data) throw new Error('Failed to open a tile session');
      return data.expires_in;
    });
    return () => setTilerSessionMinter(null);
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getSharedVisualizer({ path: { slug } });
        if (cancelled || !data) return;
        setView(data);
        setState(initialState(data));
        if (data.area) {
          const { west, south, east, north } = data.area;
          camera.current?.fitBounds([west, south, east, north], {
            paddingPx: AREA_PADDING_PX,
            minZoom: workingZoom(data),
          });
        }
        if (needsTilerSession(data)) await ensureTilerSession(slug);
      } catch {
        if (!cancelled) setFailure('This visualizer is not available.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (view) document.title = `${view.name} - STACNotator`;
  }, [view]);

  const source = view && state ? activeSource(view, state) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea')) return;
      e.preventDefault();
      setState((current) => {
        if (!current || !view) return current;
        return selectStep(view, current, current.stepIndex + (e.key === 'ArrowRight' ? 1 : -1));
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  const layers = useMemo(() => {
    const drawn = view && state ? composeLayers(view, state) : [];
    return feedback?.area ? [...drawn, feedbackAreaLayer(feedback.area)] : drawn;
  }, [view, state, feedback]);

  if (failure) {
    return (
      <Shell>
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <IconMap className="h-8 w-8 text-neutral-300" />
          <p className="text-sm text-neutral-600">{failure}</p>
          <a href="/" className="text-xs text-brand-700 underline hover:text-brand-800">
            Go to STACNotator
          </a>
        </div>
      </Shell>
    );
  }

  if (!view || !state) {
    return (
      <Shell>
        <LoadingSpinner fullScreen text="Loading visualizer…" />
      </Shell>
    );
  }

  return (
    <Shell>
      <Toaster
        position="top-center"
        closeButton
        toastOptions={{
          classNames: {
            toast: 'rounded-md border border-neutral-200 bg-white text-neutral-900 shadow-sm',
            title: 'text-sm font-medium text-neutral-900',
            description: 'text-xs text-neutral-600',
            error: 'border-l-2 border-l-red-500',
            success: 'border-l-2 border-l-brand-600',
          },
        }}
      />
      <div className="flex h-full flex-col">
        <Header
          view={view}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          feedbackOpen={feedback !== null}
          onToggleFeedback={() => setFeedback((open) => (open ? null : { area: null }))}
        />

        {/* The panel sits beside the map rather than over it, so the map's own
            scale and attribution controls stay in view. On a phone there is no
            room for both, and it covers the map instead. */}
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <MapView
              camera={camera.current!}
              layers={layers}
              attributionCollapsed
              interactions={
                feedback && !feedback.area
                  ? {
                      boxSelect: {
                        condition: 'always',
                        onBox: (area) => setFeedback({ area }),
                      },
                    }
                  : undefined
              }
            />

            {feedback && !feedback.area && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <p className="rounded-full border border-neutral-200 bg-white/95 px-3 py-1 text-xs text-neutral-600 shadow-lg backdrop-blur-sm">
                  Drag a box over the area you are commenting on
                </p>
              </div>
            )}

            {view.imagery.length === 0 && view.overlays.length === 0 && (
              <p className="pointer-events-none absolute inset-x-0 top-8 text-center text-sm text-neutral-500">
                Nothing has been added to this visualizer yet.
              </p>
            )}

            <ZoomNotice view={view} camera={camera.current!} onZoomToArea={() => frameArea(300)} />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
              {feedback?.area ? (
                <FeedbackPanel
                  view={view}
                  area={feedback.area}
                  viewing={viewingLabel(source, state.stepIndex)}
                  onClose={() => setFeedback(null)}
                  onSaved={() => setFeedback(null)}
                />
              ) : (
                source && (
                  <TimeSlider
                    steps={source.steps}
                    index={state.stepIndex}
                    onSelect={(stepIndex) => setState(selectStep(view, state, stepIndex))}
                  />
                )
              )}
            </div>
          </div>

          {sidebarOpen && (
            <ViewerSidebar
              view={view}
              state={state}
              onChange={setState}
              onCollapse={() => setSidebarOpen(false)}
              onGoTo={goTo}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}

/** Null when not giving feedback; an area of null means "still drawing it". */
type FeedbackMode = { area: Bbox | null } | null;

const FEEDBACK_LAYER_ID = 'feedback-area';

/** The box being commented on, drawn so the form is clearly about that spot. */
const feedbackAreaLayer = (area: Bbox) => ({
  kind: 'features' as const,
  id: FEEDBACK_LAYER_ID,
  zIndex: 20,
  features: [
    {
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [area[0], area[1]],
            [area[2], area[1]],
            [area[2], area[3]],
            [area[0], area[3]],
            [area[0], area[1]],
          ],
        ],
      },
    },
  ],
  style: {
    stroke: { color: '#326247', width: 2 },
    fill: { color: 'rgba(50, 98, 71, 0.15)' },
  },
});

/** What was on screen when the remark was made, so it can be placed in time. */
const viewingLabel = (
  source: VisualizerViewOut['imagery'][number] | null,
  stepIndex: number
): string | null => {
  const step = source?.steps[stepIndex];
  return source && step ? `${source.name} - ${step.label}` : null;
};

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="h-[100dvh] w-full bg-canvas text-neutral-900">{children}</div>
);

/**
 * Zoomed out far enough that the imagery is a speck, the map reads as broken
 * rather than as far away. Says so, and offers the way back.
 */
function ZoomNotice({
  view,
  camera,
  onZoomToArea,
}: {
  view: VisualizerViewOut;
  camera: Camera;
  onZoomToArea: () => void;
}) {
  const [tooFar, setTooFar] = useState(false);

  useEffect(() => {
    const update = () => setTooFar(zoomedPastArea(view.area, camera.getBounds()));
    update();
    return camera.onChange(update);
  }, [view.area, camera]);

  if (!tooFar) return null;
  return (
    <div className="pointer-events-auto absolute inset-x-0 top-3 flex justify-center">
      <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white/95 py-1 pl-3 pr-1 text-xs text-neutral-600 shadow-lg backdrop-blur-sm">
        Zoom in to see the imagery
        <Button variant="quiet" size="sm" className="!h-6 !px-2" onClick={onZoomToArea}>
          Zoom to area
        </Button>
      </div>
    </div>
  );
}

function Header({
  view,
  sidebarOpen,
  onToggleSidebar,
  feedbackOpen,
  onToggleFeedback,
}: {
  view: VisualizerViewOut;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  feedbackOpen: boolean;
  onToggleFeedback: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    void navigator.clipboard?.writeText(visualizerUrl(view.slug));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-2 py-1.5 desktop:px-4">
      <a href={HARVEST_SITE} target="_blank" rel="noreferrer" className="shrink-0">
        <HarvestMark className="h-7 w-auto" />
      </a>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-medium leading-tight text-neutral-900">{view.name}</h1>
        <p className="truncate text-[11px] leading-tight text-neutral-500">
          {view.project_name}
          {view.description ? ` - ${view.description}` : ''}
        </p>
      </div>

      {!view.is_public && (
        <span title="Only people with access to the project can open this link">
          <Badge tone="yellow">Unpublished</Badge>
        </span>
      )}

      {view.can_give_feedback && (
        <Button
          variant={feedbackOpen ? 'primary' : 'secondary'}
          size="sm"
          onClick={onToggleFeedback}
          title="Tell the people who made this map about a place on it"
          leading={<IconComment className="h-3.5 w-3.5" />}
        >
          <span className="hidden desktop:inline">Feedback</span>
        </Button>
      )}

      <Button
        variant="secondary"
        size="sm"
        onClick={copyLink}
        title="Copy the link to this visualizer"
        leading={
          copied ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />
        }
      >
        <span className="hidden desktop:inline">{copied ? 'Copied' : 'Share'}</span>
      </Button>

      {!sidebarOpen && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onToggleSidebar}
          title="Show layers"
          leading={<IconChevronDoubleLeft className="h-3.5 w-3.5" />}
        >
          <span className="hidden desktop:inline">Layers</span>
        </Button>
      )}
    </header>
  );
}
