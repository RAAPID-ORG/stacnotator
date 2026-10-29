import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { LabelBase, LabelFacet } from '~/api/client';
import { getAnnotationDensityByLabelOptions } from '~/api/queries';
import { DensityLegend } from './DensityLegend';
import {
  DensityMap,
  TARGET_CELLS,
  useDensityMap,
  useHiddenKeys,
  type AreaBounds,
} from './densityMap';
import { labelColor } from '../../utils/labelColors';

/**
 * Where each class sits across the whole campaign.
 *
 * Aggregated into a coarse grid in the database, one row per cell per class, so the
 * payload grows with cells times classes rather than with the number of annotations -
 * and so the picture is the campaign's own, independent of whatever page the table
 * happens to be showing.
 *
 * The previous version placed one Leaflet DOM marker per annotation. At 100k that is
 * 100k DOM nodes, and it needed every geometry shipped to the browser to build them.
 *
 * The campaign pages have two density maps and they answer different questions:
 *   - this one            - annotations, by class
 *   - `TaskLocationsMap`  - tasks, by task status
 * Both read a density grid and share their viewport following, cell drawing and legend
 * from `densityMap`; only what they fetch and how a category is coloured differs.
 */
interface ClassDistributionMapProps {
  campaignId: number;
  /** Campaign-wide counts per class, for the legend. */
  labelCounts: LabelFacet[];
  labels: LabelBase[];
  bbox: AreaBounds;
}

const NO_LABEL_COLOR = '#9CA3AF';
const NO_LABEL_KEY = -1;

export const ClassDistributionMap: React.FC<ClassDistributionMapProps> = ({
  campaignId,
  labelCounts,
  labels,
  bbox,
}) => {
  const { t } = useTranslation('review');
  const { camera, view } = useDensityMap(bbox);
  const { hidden, toggle } = useHiddenKeys<number>();
  const { data: cells = [] } = useQuery({
    ...getAnnotationDensityByLabelOptions({
      path: { campaign_id: campaignId },
      query: { bbox: view ?? '', target_cells: TARGET_CELLS },
    }),
    enabled: view !== null,
    placeholderData: keepPreviousData,
    meta: { errorMessage: t('densityMap.loadFailed') },
  });

  const keyOf = (labelId: number | null) => labelId ?? NO_LABEL_KEY;
  const colorOf = (labelId: number | null) => {
    const index = labels.findIndex((l) => l.id === labelId);
    return index === -1 ? NO_LABEL_COLOR : labelColor(index);
  };
  const nameOf = (labelId: number | null) =>
    labelId === null
      ? t('noLabel')
      : (labels.find((l) => l.id === labelId)?.name ?? t('labelFallback', { id: labelId }));

  const visible = useMemo(
    () =>
      cells
        .map((cell) => ({
          lon: cell.lon,
          lat: cell.lat,
          count: cell.count,
          key: keyOf(cell.label_id),
        }))
        .filter((point) => !hidden.has(point.key)),
    [cells, hidden]
  );

  const legend = [
    ...labels.map((label, index) => ({
      key: label.id,
      name: label.name,
      color: labelColor(index),
      count: labelCounts.find((c) => c.label_id === label.id)?.count ?? 0,
    })),
    {
      key: NO_LABEL_KEY,
      name: t('noLabel'),
      color: NO_LABEL_COLOR,
      count: labelCounts.find((c) => c.label_id === null)?.count ?? 0,
    },
  ].filter((entry) => entry.count > 0);

  return (
    <div>
      <DensityLegend entries={legend} hidden={hidden} onToggle={toggle} />

      <DensityMap
        camera={camera}
        area={bbox}
        points={visible}
        colorOf={(key) => colorOf(key === NO_LABEL_KEY ? null : key)}
        nameOf={(key) => nameOf(key === NO_LABEL_KEY ? null : key)}
        className="w-full h-96 rounded-lg border border-neutral-200"
      />
    </div>
  );
};
