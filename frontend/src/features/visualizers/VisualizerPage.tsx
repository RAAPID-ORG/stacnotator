import { useEffect, useMemo, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import {
  getSharedVisualizer,
  getVisualizerTilerToken,
  updateVisualizer,
  type VisualizerViewOut,
} from '~/api/client';
import { ensureTilerSession, setTilerSessionMinter } from '~/api/tilerToken';
import { Camera } from '~/shared/map/Camera';
import { MapView } from '~/shared/map/MapView';
import { HarvestMark, HARVEST_SITE } from '~/shared/ui/HarvestMark';
import { IconChevronDoubleLeft, IconCheck, IconCopy, IconMap } from '~/shared/ui/Icons';
import { LoadingSpinner } from '~/shared/ui/LoadingSpinner';
import { handleError } from '~/shared/utils/errorHandler';
import { visualizerUrl } from './route';
import { TimeSlider } from './viewer/TimeSlider';
import { ViewerSidebar } from './viewer/ViewerSidebar';
import {
  activeSource,
  composeLayers,
  initialState,
  needsTilerSession,
  type ViewerState,
} from './viewerState';

const WORLD = { center: [0, 20] as [number, number], zoom: 2 };

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
  // On a phone the panel covers the map, so it starts out of the way.
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 640);
  const camera = useRef<Camera>(null);
  camera.current ??= new Camera(WORLD);

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
        if (data.camera) {
          camera.current?.moveTo({
            center: [data.camera.lon, data.camera.lat],
            zoom: data.camera.zoom,
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
        if (!current || !source) return current;
        const last = source.steps.length - 1;
        const next = current.stepIndex + (e.key === 'ArrowRight' ? 1 : -1);
        return { ...current, stepIndex: Math.min(last, Math.max(0, next)) };
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source]);

  const layers = useMemo(() => (view && state ? composeLayers(view, state) : []), [view, state]);

  if (failure) {
    return (
      <Shell>
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <IconMap className="h-8 w-8 text-white/25" />
          <p className="text-sm text-white/60">{failure}</p>
          <a href="/" className="text-xs text-brand-400 underline hover:text-brand-300">
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
      <Toaster position="top-center" closeButton theme="dark" />
      <div className="flex h-full flex-col">
        <Header
          view={view}
          camera={camera.current!}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
        />

        {/* The panel sits beside the map rather than over it, so the map's own
            scale and attribution controls stay in view. On a phone there is no
            room for both, and it covers the map instead. */}
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <MapView camera={camera.current!} layers={layers} attributionCollapsed />

            {view.imagery.length === 0 && view.overlays.length === 0 && (
              <p className="pointer-events-none absolute inset-x-0 top-8 text-center text-sm text-white/50">
                Nothing has been added to this visualizer yet.
              </p>
            )}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
              {source && (
                <TimeSlider
                  steps={source.steps}
                  index={state.stepIndex}
                  onSelect={(stepIndex) => setState({ ...state, stepIndex })}
                />
              )}
            </div>
          </div>

          {sidebarOpen && (
            <ViewerSidebar
              view={view}
              state={state}
              onChange={setState}
              onCollapse={() => setSidebarOpen(false)}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="h-[100dvh] w-full bg-neutral-950 text-white">{children}</div>
);

function Header({
  view,
  camera,
  sidebarOpen,
  onToggleSidebar,
}: {
  view: VisualizerViewOut;
  camera: Camera;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [savedView, setSavedView] = useState(false);

  const copyLink = () => {
    void navigator.clipboard?.writeText(visualizerUrl(view.slug));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const saveCamera = async () => {
    const { center, zoom } = camera.getState();
    try {
      await updateVisualizer({
        path: { visualizer_id: view.id },
        body: { camera: { lon: center[0], lat: center[1], zoom } },
      });
      setSavedView(true);
      setTimeout(() => setSavedView(false), 1600);
    } catch (error) {
      handleError(error, 'Could not save this view');
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-neutral-900 px-4">
      <a href={HARVEST_SITE} target="_blank" rel="noreferrer" className="shrink-0">
        <HarvestMark className="h-6 w-auto opacity-80 transition-opacity hover:opacity-100" />
      </a>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-medium leading-tight">{view.name}</h1>
        <p className="truncate text-[11px] leading-tight text-white/40">
          {view.project_name}
          {view.description ? ` - ${view.description}` : ''}
        </p>
      </div>

      {!view.is_public && (
        <span
          className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300"
          title="Only people with access to the project can open this link"
        >
          Unpublished
        </span>
      )}

      {view.can_edit && (
        <HeaderButton
          onClick={() => void saveCamera()}
          label="Save this as the opening view"
          className="hidden sm:flex"
        >
          {savedView ? 'Saved' : 'Save view'}
        </HeaderButton>
      )}

      <HeaderButton
        onClick={copyLink}
        label="Copy the link to this visualizer"
        icon={copied ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
      >
        {copied ? 'Copied' : 'Share'}
      </HeaderButton>

      {!sidebarOpen && (
        <HeaderButton
          onClick={onToggleSidebar}
          label="Show layers"
          icon={<IconChevronDoubleLeft className="h-3.5 w-3.5" />}
        >
          Layers
        </HeaderButton>
      )}
    </header>
  );
}

/** Icon-only on a phone: the title needs the room more than the words do. */
const HeaderButton = ({
  onClick,
  label,
  icon,
  className,
  children,
}: {
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white ${className ?? ''}`}
  >
    {icon}
    <span className={icon ? 'hidden sm:inline' : undefined}>{children}</span>
  </button>
);
