import type { ReactNode } from 'react';
import { IconInfo } from '~/shared/ui/Icons';
import { useCatalog } from '../../stores/campaign';
import {
  loadScenesHere,
  useSceneDateLoading,
  useScenesLoadable,
  useScenesLoading,
  useScenesUncovered,
  useShownSceneSource,
} from '../../stores/scenes';
import { PillSpinner, StatusPill } from '../../components/StatusPill';
import { SCENE_LOAD_HINT } from '../ImageryWindow/SceneLoadButton';

/**
 * Planet imagery belongs to the viewport it was searched over, so panning far enough
 * leaves it behind - on the map that looks like imagery that just stopped. One line
 * saying so, and offering the load, in the same place the zoom hints appear.
 *
 * Only while the map is actually showing that imagery: offering to load Planet over a
 * Sentinel-2 map is an offer to fill something the annotator cannot see.
 */
export function useSceneNotice(): ReactNode {
  const catalog = useCatalog();
  const source = useShownSceneSource();
  const uncovered = useScenesUncovered(source);
  const loadable = useScenesLoadable();
  const loading = useScenesLoading();
  const opening = useSceneDateLoading();

  if (!source) return null;
  if (loading) {
    return (
      <StatusPill>
        <PillSpinner />
        Loading Planet imagery for this viewport
      </StatusPill>
    );
  }
  // The window is already searched; this is one date getting its own layer.
  if (opening) {
    return (
      <StatusPill>
        <PillSpinner />
        Loading Planet imagery for this date
      </StatusPill>
    );
  }
  if (!uncovered) return null;
  if (!loadable) return <StatusPill>Zoom in to load Planet imagery</StatusPill>;

  return (
    <StatusPill interactive>
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          data-testid="scene-notice"
          onClick={() => loadScenesHere([source], catalog.campaignId)}
          className="cursor-pointer underline decoration-white/40 underline-offset-2 hover:decoration-white"
        >
          Load Planet imagery for this viewport
        </button>
        <span title={SCENE_LOAD_HINT} className="cursor-help text-white/70 hover:text-white">
          <IconInfo />
        </span>
      </span>
    </StatusPill>
  );
}
