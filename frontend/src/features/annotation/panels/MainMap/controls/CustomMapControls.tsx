import { type Catalog } from '../../../campaign/catalog';
import { readyCustomMaps } from '../../../campaign/renderConfig';
import { useImageryStore } from '../../../stores/imagery';
import { IconExternalLink } from '~/shared/ui/Icons';
import { HeaderSelect } from '../../../components/HeaderSelect';

const OverlayIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 20 20"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <polygon points="10,3 18,8 10,13 2,8" />
    <path d="M2 12l8 5 8-5" opacity="0.5" />
  </svg>
);

export function CustomMapControls({
  catalog,
  toggleTitle,
}: {
  catalog: Catalog;
  toggleTitle: string;
}) {
  const overlay = useImageryStore((s) => s.overlay);
  const overlayAction = useImageryStore((s) => s.overlayAction);

  const maps = readyCustomMaps([...catalog.customMaps.values()]);
  if (maps.length === 0) return null;
  const active = maps.find((m) => m.id === overlay.id);

  return (
    <div className="flex items-center gap-1" data-testid="custom-map-controls">
      <div className="mx-0.5 h-3 w-px bg-neutral-200" />
      <HeaderSelect
        icon={<OverlayIcon className="opacity-40" />}
        value={overlay.id ?? ''}
        options={[
          { value: '', label: 'No overlay' },
          ...maps.map((m) => ({ value: m.id, label: m.name })),
        ]}
        onChange={(v: string | number) => {
          // "No overlay" clears the pick; picking a map is a cycle over the
          // one-item list holding it. Both go through the same action, so
          // keyboard and mouse cannot drift apart.
          if (v === '') overlayAction(maps, 'deselect');
          else
            overlayAction(
              maps.filter((m) => m.id === Number(v)),
              'cycle'
            );
        }}
        title="Select overlay map"
      />
      {active?.mlops_url && (
        <a
          href={active.mlops_url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="custom-map-mlops-link"
          title="Open linked experiment"
          className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
        >
          <IconExternalLink className="h-3 w-3" />
        </a>
      )}
      {active && (
        <button
          type="button"
          data-testid="custom-map-toggle"
          aria-pressed={overlay.visible}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => overlayAction(maps, 'toggle')}
          title={toggleTitle}
          className={`flex h-6 w-6 items-center justify-center rounded-md cursor-pointer ${overlay.visible ? 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700' : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500'}`}
        >
          <OverlayIcon />
        </button>
      )}
    </div>
  );
}
