import type { PlanetMosaicOut } from '~/api/client';
import type { CollectionItem, ImagerySlice } from './types';
import { createId } from './types';

/** How many of a series' mosaics share one collection - i.e. one canvas window. */
export const COLLECTION_PERIODS = ['month', 'quarter', 'year', 'all'] as const;
export type CollectionPeriod = (typeof COLLECTION_PERIODS)[number];

export interface PlanetGenerationOptions {
  seriesName: string;
  /** Inclusive YYYY-MM-DD bounds on the mosaic's own start date. */
  startDate: string;
  endDate: string;
  collectionPeriod: CollectionPeriod;
  /** 1-based slice shown first in each collection. */
  coverNth: number;
  /** Visualization names to build tile URLs for, from the series' renderings. */
  renderings: string[];
}

/** Mosaics that can become slices. Planet reports the rest with a reason, which
 *  the wizard shows: a gap in a temporal series is not something to hide. */
export function usableMosaics(mosaics: PlanetMosaicOut[]): PlanetMosaicOut[] {
  return mosaics.filter((m) => !m.unavailable_reason && Object.keys(m.tile_urls ?? {}).length > 0);
}

function collectionKey(startDate: string, period: CollectionPeriod): string {
  if (period === 'all') return 'all';
  const year = startDate.slice(0, 4);
  if (period === 'year') return year;
  if (period === 'quarter')
    return `${year} Q${Math.floor((Number(startDate.slice(5, 7)) - 1) / 3) + 1}`;
  return startDate.slice(0, 7);
}

/** A whole calendar month reads better as `2024-01` than as its first day. */
function sliceName(mosaic: PlanetMosaicOut): string {
  const wholeMonth =
    mosaic.first_acquired.endsWith('-01') &&
    mosaic.first_acquired.slice(0, 7) === mosaic.last_acquired.slice(0, 7);
  return wholeMonth ? mosaic.first_acquired.slice(0, 7) : mosaic.first_acquired;
}

function toSlice(mosaic: PlanetMosaicOut, renderings: string[]): ImagerySlice {
  const urls = mosaic.tile_urls ?? {};
  return {
    id: createId(),
    name: sliceName(mosaic),
    startDate: mosaic.first_acquired,
    endDate: mosaic.last_acquired,
    vizUrls: renderings
      .filter((name) => urls[name])
      .map((name) => ({ vizName: name, url: urls[name] })),
  };
}

/** Expand a Planet series into the collections a source is made of.
 *
 *  The result is ordinary manual collections: Planet mosaics are already-built
 *  XYZ tiles, so there is nothing to search, register or render on a tiler. The
 *  slices' dates come from the mosaics themselves rather than from arithmetic
 *  over a requested cadence, so they cannot drift from what Planet actually has.
 */
export function generatePlanetCollections(
  mosaics: PlanetMosaicOut[],
  options: PlanetGenerationOptions
): CollectionItem[] {
  const inRange = usableMosaics(mosaics).filter(
    (m) => m.first_acquired >= options.startDate && m.first_acquired <= options.endDate
  );

  const groups = new Map<string, PlanetMosaicOut[]>();
  for (const mosaic of inRange) {
    const key = collectionKey(mosaic.first_acquired, options.collectionPeriod);
    groups.set(key, [...(groups.get(key) ?? []), mosaic]);
  }

  return [...groups].map(([key, groupMosaics]) => {
    const slices = groupMosaics.map((m) => toSlice(m, options.renderings));
    return {
      id: createId(),
      name: key === 'all' ? options.seriesName : key,
      slices,
      coverSliceIndex: Math.min(Math.max(options.coverNth, 1) - 1, slices.length - 1),
      hasDedicatedCover: false,
      data: {
        type: 'manual',
        vizUrls: slices[0]?.vizUrls ?? [],
      },
    };
  });
}
