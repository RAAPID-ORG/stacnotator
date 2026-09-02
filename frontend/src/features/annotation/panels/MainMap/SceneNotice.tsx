import type { ReactNode } from 'react';
import { IconInfo } from '~/shared/ui/Icons';
import { useCatalog } from '../../stores/campaign';
import {
  loadScenesHere,
  useSceneSourcesInView,
  useScenesLoadable,
  useScenesLoading,
  useScenesUncovered,
} from '../../stores/scenes';
import { PillSpinner, StatusPill } from '../../components/StatusPill';
import { SCENE_LOAD_HINT } from '../ImageryWindow/SceneLoadButton';

/**
 * Planet imagery belongs to the view it was searched over, so panning far enough
 * leaves it behind - on the map that looks like imagery that just stopped. One line
 * saying so, and offering the load, in the same place the zoom hints appear.
 */
export function useSceneNotice(): ReactNode {
  const catalog = useCatalog();
  const sources = useSceneSourcesInView();
  const uncovered = useScenesUncovered();
  const loadable = useScenesLoadable();
  const loading = useScenesLoading();

  if (sources.length === 0) return null;
  if (loading) {
    return (
      <StatusPill>
        <PillSpinner />
        Loading Planet imagery for this view
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
          onClick={() => loadScenesHere(sources, catalog.campaignId)}
          className="cursor-pointer underline decoration-white/40 underline-offset-2 hover:decoration-white"
        >
          Load Planet imagery for this view
        </button>
        <span title={SCENE_LOAD_HINT} className="cursor-help text-white/70 hover:text-white">
          <IconInfo />
        </span>
      </span>
    </StatusPill>
  );
}
