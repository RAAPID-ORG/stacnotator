import type { ImagerySourceOut } from '~/api/client';
import { IconSearch } from '~/shared/ui/Icons';
import { useSceneSearch } from './useSceneSearch';

/** Fills a scene source's dates in from the archive over whatever is on screen.
 *  Deliberately a button rather than something that fires on every pan: each search
 *  spends the organization's Planet quota. */
export function SceneSearchButton({ source }: { source: ImagerySourceOut }) {
  const { run, searching, found } = useSceneSearch(source);

  return (
    <button
      type="button"
      data-testid="scene-search"
      data-searching={searching}
      disabled={searching}
      title={
        found === null
          ? 'Search Planet for imagery over this view'
          : `${found} date${found === 1 ? '' : 's'} here. Search again after moving.`
      }
      onClick={(e) => {
        e.stopPropagation();
        run();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
        searching
          ? 'cursor-wait text-neutral-400'
          : 'text-brand-700 hover:bg-brand-700/10 cursor-pointer'
      }`}
    >
      <IconSearch className="h-3 w-3" />
      {searching ? 'Searching…' : found === null ? 'Search here' : `${found}`}
    </button>
  );
}
