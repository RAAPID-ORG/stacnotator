import { useTranslation } from 'react-i18next';
import type { ImagerySourceOut } from '~/api/client';
import { IconRefresh } from '~/shared/ui/Icons';
import { useCatalog } from '../../stores/campaign';
import { loadScenesHere, useScenesLoadable, useScenesStore } from '../../stores/scenes';

/** Fills a scene source's dates in from the archive over whatever is on screen.
 *  Deliberately pressed rather than fired on every pan: each load spends the
 *  organization's Planet rate limit. An icon alone in here - a window header has
 *  room for the date it is showing, and little else. */
export function SceneLoadButton({ source }: { source: ImagerySourceOut }) {
  const { t } = useTranslation('panels');
  const catalog = useCatalog();
  const loading = useScenesStore((state) => state.loading[source.id] ?? false);
  const tooWide = !useScenesLoadable();

  return (
    <button
      type="button"
      data-testid="scene-load"
      data-loading={loading}
      disabled={loading || tooWide}
      title={tooWide ? t('scenes.tooWide') : t('scenes.loadHint')}
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
      aria-label={t('scenes.load')}
    >
      <IconRefresh className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
    </button>
  );
}
