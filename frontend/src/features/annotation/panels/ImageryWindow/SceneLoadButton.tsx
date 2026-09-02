import type { ImagerySourceOut } from '~/api/client';
import { IconSearch } from '~/shared/ui/Icons';
import { useCatalog } from '../../stores/campaign';
import { loadScenesHere, useScenesLoadable, useScenesStore } from '../../stores/scenes';

/** What a load actually does, said the same way wherever it is offered. */
export const SCENE_LOAD_HINT =
  'Searches Planet scnenes over the current viewport is on screen. One search per date (slice) - and builds each date ' +
  'from the clearest scenes it finds. Dates with nothing here stay empty. Worth doing ' +
  'when the imagery looks poor or there is none; moving the map only needs another ' +
  'load once you leave what was searched.';

/** Fills a scene source's dates in from the archive over whatever is on screen.
 *  Deliberately pressed rather than fired on every pan: each load spends the
 *  organization's Planet rate limit on a search per date. */
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
          ? 'Zoom in to load Planet imagery: a view this wide holds more archive than one search should ask for.'
          : SCENE_LOAD_HINT
      }
      onClick={(e) => {
        e.stopPropagation();
        loadScenesHere([source], catalog.campaignId);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
        loading || tooWide
          ? 'cursor-not-allowed text-neutral-400'
          : 'text-brand-700 hover:bg-brand-700/10 cursor-pointer'
      }`}
    >
      <IconSearch className="h-3 w-3" />
      {loading ? 'Loading…' : 'Load viewport'}
    </button>
  );
}
