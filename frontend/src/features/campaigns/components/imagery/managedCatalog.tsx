import { useState } from 'react';
import type { AssetInfo, CollectionOut } from '~/api/client';
import { Input } from '~/shared/ui/forms';
import { vizParamsToFrontend } from './controller';
import type { NamedVizParams } from './types';

/** The asset key every managed cloud catalog item exposes for its GeoTIFF. */
export const MANAGED_ASSET_KEY = 'data';

/** A catalog's suggested presets as editable visualizations: copied once, never linked. */
export const catalogPresets = (collection: CollectionOut): NamedVizParams[] =>
  collection.visualizations.map((v) => ({
    name: v.name,
    vizParams: vizParamsToFrontend(v.viz_params),
  }));

const highestBand = (visualizations: NamedVizParams[]): number =>
  Math.max(0, ...visualizations.flatMap((v) => v.vizParams.bidx ?? []));

/** Managed catalogs record no band metadata, so the user states how many bands their files
 *  carry and the band pickers offer that many. Saved band indexes always stay selectable. */
export const useManagedAssets = (visualizations: NamedVizParams[]) => {
  const [stated, setStated] = useState<number | null>(null);
  const bandCount = Math.max(stated ?? 0, highestBand(visualizations), 1);
  const assets: Record<string, AssetInfo> = {
    [MANAGED_ASSET_KEY]: {
      title: 'GeoTIFF',
      type: 'image/tiff; application=geotiff',
      roles: ['data'],
      bands: Array.from({ length: bandCount }, (_, i) => ({ name: `Band ${i + 1}` })),
    },
  };
  return { assets, bandCount, setBandCount: setStated };
};

export const ManagedBandCountField = ({
  bandCount,
  onChange,
}: {
  bandCount: number;
  onChange: (count: number) => void;
}) => (
  <label className="flex items-center gap-2 text-xs text-neutral-700">
    Bands in each file
    <Input
      size="sm"
      type="number"
      min={1}
      max={64}
      className="w-20"
      aria-label="Bands in each file"
      value={bandCount}
      onChange={(e) => {
        const count = Number(e.target.value);
        if (Number.isInteger(count) && count >= 1 && count <= 64) onChange(count);
      }}
    />
    <span className="text-[11px] text-neutral-500">
      The catalog does not record band metadata; pick bands by their number in the file.
    </span>
  </label>
);
