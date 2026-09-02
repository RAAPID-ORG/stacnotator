import type { ImagerySourceOut } from '~/api/client';
import { IconRefresh } from '~/shared/ui/Icons';
import { useCatalog } from '../../stores/campaign';
import { loadScenesHere, useScenesLoadable, useScenesStore } from '../../stores/scenes';

/** What a load actually does, said the same way wherever it is offered. */
export const SCENE_LOAD_HINT =
  'Load Planet imagery for this viewport: the dates with imagery here become ' +
  'steppable, each built from the clearest scenes it finds, and the rest stay empty. ' +
  'Worth doing when the imagery looks poor or there is none; moving the map only ' +
  'needs another load once you leave what was loaded.';

/** Fills a scene source's dates in from the archive over whatever is on screen.
 *  Deliberately pressed rather than fired on every pan: each load spends the
 *  organization's Planet rate limit. An icon alone in here - a window header has
 *  room for the date it is showing, and little else. */
export function SceneLoadButton({ source }: { source: ImagerySourceOut }) {
  const catalog = useCatalog();
  const loading = useScenesStore((state) => state.loading[source.id] ?? false);
  const tooWide = !useScenesLoadable();

  return (
    <button
      type="button"
      data-testid="scene-load"
      data-loading={loading}
      disabled={loading || tooWide}
      title={
        tooWide
          ? 'Zoom in to load Planet imagery: a viewport this wide holds more archive than one search should ask for.'
          : SCENE_LOAD_HINT
      }
      onClick={(e) => {
        e.stopPropagation();
        loadScenesHere([source], catalog.campaignId);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className={`flex shrink-0 items-center rounded p-0.5 ${
        loading || tooWide
          ? 'cursor-not-allowed text-neutral-400'
          : 'text-brand-700 hover:bg-brand-700/10 cursor-pointer'
      }`}
      aria-label="Load Planet imagery for this viewport"
    >
      <IconRefresh className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
    </button>
  );
}
