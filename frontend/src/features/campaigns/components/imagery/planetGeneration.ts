import type { PlanetMosaicOut } from '~/api/client';
import type { CollectionItem, ImagerySlice, VisualizationUrl } from './types';
import { createId } from './types';

/** How many of a series' mosaics share one collection - i.e. one canvas window.
 *  Only consulted without a cover series; with one, the cover mosaics are the
 *  windows. */
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
  /** A coarser series' mosaics. Each becomes one window's dedicated cover and
   *  the finer mosaics inside its span become that window's slices. Planet has
   *  no compositing, so the coarse product *is* the composite - the equivalent
   *  of a STAC cover slice searched over the whole window. Without it, windows
   *  come from `collectionPeriod` and the cover is the `coverNth` slice. */
  coverMosaics?: PlanetMosaicOut[];
}

export interface PlanetCollections {
  collections: CollectionItem[];
  /** Usable mosaics in range that no cover window contains. Reported rather
   *  than dropped: imagery silently missing from a series is a trap. */
  orphans: PlanetMosaicOut[];
}

/** Mosaics that can become slices. Planet reports the rest with a reason, which
 *  the wizard shows: a gap in a temporal series is not something to hide. */
export function usableMosaics(mosaics: PlanetMosaicOut[]): PlanetMosaicOut[] {
  return mosaics.filter((m) => !m.unavailable_reason && Object.keys(m.tile_urls ?? {}).length > 0);
}

/** The range the wizard proposes: the newest year the series has. A series
 *  running since 2016 otherwise offers its whole history, and anyone who skips
 *  this step lands on a campaign with a hundred-odd collections. */
export function defaultMosaicRange(mosaics: PlanetMosaicOut[]): {
  startDate: string;
  endDate: string;
} {
  const dates = usableMosaics(mosaics).map((m) => m.first_acquired);
  if (dates.length === 0) return { startDate: '', endDate: '' };

  const endDate = dates.reduce((a, b) => (a > b ? a : b));
  const oldest = dates.reduce((a, b) => (a < b ? a : b));
  const aYearBack = new Date(`${endDate}T00:00:00Z`);
  aYearBack.setUTCFullYear(aYearBack.getUTCFullYear() - 1);
  const capped = aYearBack.toISOString().slice(0, 10);

  return { startDate: oldest > capped ? oldest : capped, endDate };
}

/** Renderings a cover series can actually stand in for. A slice with no tile
 *  URL for the visualization the annotator picked throws at draw time, so a
 *  cover may only offer what the finer series offers too. */
export function sharedRenderings(sliceSeries: string[], coverSeries: string[]): string[] {
  return sliceSeries.filter((name) => coverSeries.includes(name));
}

const lastDayOfMonth = (date: string): number => {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

const startsMonth = (date: string) => date.endsWith('-01');
const endsMonth = (date: string) => Number(date.slice(8)) === lastDayOfMonth(date);

/** A window is titled by the span it covers. Whole calendar units read as
 *  themselves; anything else says where it starts and ends. */
function windowName(start: string, end: string): string {
  if (!startsMonth(start) || !endsMonth(end)) return `${start} → ${end}`;
  const [from, to] = [start.slice(0, 7), end.slice(0, 7)];
  if (from === to) return from;
  if (start.slice(5) === '01-01' && end.slice(5) === '12-31')
    return from.slice(0, 4) === to.slice(0, 4)
      ? from.slice(0, 4)
      : `${from.slice(0, 4)} → ${to.slice(0, 4)}`;
  return `${from} → ${to}`;
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

function toSlice(mosaic: PlanetMosaicOut, renderings: string[], label?: string): ImagerySlice {
  const urls = mosaic.tile_urls ?? {};
  return {
    id: createId(),
    name: label ?? sliceName(mosaic),
    startDate: mosaic.first_acquired,
    endDate: mosaic.last_acquired,
    vizUrls: renderings
      .filter((name) => urls[name])
      .map((name) => ({ vizName: name, url: urls[name] })),
  };
}

const manualCollection = (
  name: string,
  slices: ImagerySlice[],
  cover: { index: number; dedicated: boolean },
  /** Seeds the collection editor's URL fields; the slices are what is stored. */
  vizUrls: VisualizationUrl[]
): CollectionItem => ({
  id: createId(),
  name,
  slices,
  coverSliceIndex: cover.index,
  hasDedicatedCover: cover.dedicated,
  data: { type: 'manual', vizUrls },
});

/** Windows from the calendar, cover from the slices themselves. */
function groupedCollections(
  mosaics: PlanetMosaicOut[],
  options: PlanetGenerationOptions
): CollectionItem[] {
  const groups = new Map<string, PlanetMosaicOut[]>();
  for (const mosaic of mosaics) {
    const key = collectionKey(mosaic.first_acquired, options.collectionPeriod);
    groups.set(key, [...(groups.get(key) ?? []), mosaic]);
  }

  return [...groups].map(([key, groupMosaics]) => {
    const slices = groupMosaics.map((m) => toSlice(m, options.renderings));
    return manualCollection(
      key === 'all' ? options.seriesName : key,
      slices,
      {
        index: Math.min(Math.max(options.coverNth, 1) - 1, slices.length - 1),
        dedicated: false,
      },
      slices[0]?.vizUrls ?? []
    );
  });
}

/** Windows from a coarser series: each of its mosaics covers one window, and
 *  the finer mosaics starting inside that span are its slices. A window whose
 *  span holds no finer mosaic is still real imagery, so it is kept with its
 *  cover alone. */
function coveredCollections(
  mosaics: PlanetMosaicOut[],
  coverMosaics: PlanetMosaicOut[],
  options: PlanetGenerationOptions
): PlanetCollections {
  const covers = usableMosaics(coverMosaics).filter(
    (m) => m.last_acquired >= options.startDate && m.first_acquired <= options.endDate
  );
  const covered = new Set<string>();

  const collections = covers.map((cover) => {
    const inside = mosaics.filter(
      (m) => m.first_acquired >= cover.first_acquired && m.first_acquired <= cover.last_acquired
    );
    inside.forEach((m) => covered.add(m.id));

    const name = windowName(cover.first_acquired, cover.last_acquired);
    const slices = [
      toSlice(cover, options.renderings, name),
      ...inside.map((m) => toSlice(m, options.renderings)),
    ];
    return manualCollection(name, slices, { index: 0, dedicated: true }, slices[1]?.vizUrls ?? []);
  });

  return { collections, orphans: mosaics.filter((m) => !covered.has(m.id)) };
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
): PlanetCollections {
  const inRange = usableMosaics(mosaics).filter(
    (m) => m.first_acquired >= options.startDate && m.first_acquired <= options.endDate
  );

  return options.coverMosaics
    ? coveredCollections(inRange, options.coverMosaics, options)
    : { collections: groupedCollections(inRange, options), orphans: [] };
}
