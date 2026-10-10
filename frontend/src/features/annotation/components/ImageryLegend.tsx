import { formatTick, gradientFor } from '~/shared/colormaps/colormaps';
import type { ImageryCatalog } from '../campaign/imagery';
import type { SliceAddress } from '../campaign/imageryNav';
import { sliceLegend } from '../campaign/tileUrls';
import { usePrefsStore } from '../stores/prefs';

export function ImageryLegend({
  catalog,
  address,
}: {
  catalog: ImageryCatalog;
  address: SliceAddress | null;
}) {
  const override = usePrefsStore((state) =>
    address ? state.legendOverrides[Number(address.vizId)] : undefined
  );
  const legend = sliceLegend(catalog, address, override);
  if (!legend) return null;

  return (
    <div
      className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 p-2 text-[10px] text-neutral-700 shadow"
      data-testid="imagery-legend"
      aria-label={`${legend.name} color scale`}
    >
      <div className="mb-1 font-medium">{legend.name}</div>
      <div className="h-2 w-28 rounded-sm" style={{ background: gradientFor(legend.colormap) }} />
      <div className="mt-0.5 flex justify-between gap-2">
        <span>{legend.range ? formatTick(legend.range[0]) : 'Min (auto)'}</span>
        <span>{legend.range ? formatTick(legend.range[1]) : 'Max (auto)'}</span>
      </div>
    </div>
  );
}
