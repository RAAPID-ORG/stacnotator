import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AssetInfo, CollectionOut } from '~/api/client';
import { getCollectionOptions } from '~/api/queries';
import { Input } from '~/shared/ui/forms';
import { vizParamsToFrontend } from './controller';
import type { NamedVizParams } from './types';

/** Older single-file catalogs use this default asset key. */
export const MANAGED_ASSET_KEY = 'data';

/** A catalog's suggested presets as editable visualizations: copied once, never linked. */
export const catalogPresets = (collection: CollectionOut): NamedVizParams[] =>
  collection.visualizations.map((v) => ({
    name: v.name,
    vizParams: vizParamsToFrontend(v.viz_params),
  }));

const highestBand = (visualizations: NamedVizParams[]): number =>
  Math.max(0, ...visualizations.flatMap((v) => v.vizParams.bidx ?? []));

export const useManagedAssets = (visualizations: NamedVizParams[], collectionId?: number) => {
  const metadata = useQuery({
    ...getCollectionOptions({ path: { collection_id: collectionId ?? 0 } }),
    enabled: collectionId !== undefined,
    meta: { errorMessage: 'Failed to load catalog band metadata', showUser: false },
  });
  const [stated, setStated] = useState<number | null>(null);
  const bandCount = Math.max(stated ?? 0, highestBand(visualizations), 1);
  const fallback: Record<string, AssetInfo> = {
    [MANAGED_ASSET_KEY]: {
      title: 'GeoTIFF',
      type: 'image/tiff; application=geotiff',
      roles: ['data'],
      bands: Array.from({ length: bandCount }, (_, i) => ({ name: `Band ${i + 1}` })),
    },
  };
  const recorded = metadata.data?.item_assets;
  const hasMetadata = !!recorded && Object.keys(recorded).length > 0;
  const legacy = metadata.data?.status === 'ready' && !hasMetadata;
  return {
    assets: hasMetadata ? recorded : legacy ? fallback : {},
    hasMetadata,
    legacy,
    bandCount,
    setBandCount: setStated,
    error: metadata.error,
  };
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
      This older catalog has no band metadata; pick bands by their number in the file.
    </span>
  </label>
);
