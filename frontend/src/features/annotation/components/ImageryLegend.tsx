import { useTranslation } from 'react-i18next';
import { formatTick, gradientFor } from '~/shared/colormaps/colormaps';
import type { ImageryCatalog } from '../campaign/imagery';
import type { SliceAddress } from '../campaign/imageryNav';
import { sliceLegend } from '../campaign/tileUrls';

/** The colormap scale of the slice shown. ``compact`` is a small window's: one
 *  strip along its bottom edge, range and colors only, so it hides little imagery. */
export function ImageryLegend({
  catalog,
  address,
  compact = false,
}: {
  catalog: ImageryCatalog;
  address: SliceAddress | null;
  compact?: boolean;
}) {
  const { t } = useTranslation('annotation');
  const legend = sliceLegend(catalog, address);
  if (!legend) return null;
  const min = legend.range ? formatTick(legend.range[0]) : t('legend.minAuto');
  const max = legend.range ? formatTick(legend.range[1]) : t('legend.maxAuto');

  if (compact) {
    return (
      <div
        className="imagery-legend-strip pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/45 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm"
        data-testid="imagery-legend"
        aria-label={t('legend.scale', { name: legend.name })}
      >
        <span>{min}</span>
        <div
          className="h-1.5 flex-1 rounded-sm"
          style={{ background: gradientFor(legend.colormap) }}
        />
        <span>{max}</span>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute bottom-8 left-1.5 rounded bg-white/85 px-1.5 py-1 text-[9px] leading-tight text-neutral-700 shadow-sm"
      data-testid="imagery-legend"
      aria-label={t('legend.scale', { name: legend.name })}
    >
      <div className="mb-0.5 max-w-20 truncate font-medium">{legend.name}</div>
      <div className="h-1.5 w-20 rounded-sm" style={{ background: gradientFor(legend.colormap) }} />
      <div className="mt-px flex justify-between gap-2">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
