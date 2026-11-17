import type { PlanetMosaicOut } from '~/api/client';
import type { CollectionItem, ImagerySlice, VisualizationUrl } from './types';
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
  /** 1-based slice shown first in each collection, when there is no cover series. */
  coverNth: number;
  /** Visualization names to build tile URLs for, from the series' renderings. */
  renderings: string[];
  /** Another series' mosaics, one of which becomes each window's dedicated cover. */
  coverMosaics?: PlanetMosaicOut[];
}

export interface PlanetCollections {
  collections: CollectionItem[];
  /** Windows no cover-series mosaic overlaps; they open on their first mosaic. */
  uncovered: string[];
  /** Windows whose cover-series mosaic spans only part of them. */
  partlyCovered: string[];
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

interface Window {
  key: string;
  start: string;
  end: string;
  mosaics: PlanetMosaicOut[];
}

const isoDay = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);

/** The calendar span a window covers, which a cover mosaic is matched against. */
function windowSpan(key: string, mosaics: PlanetMosaicOut[]): { start: string; end: string } {
  if (key === 'all')
    return {
      start: mosaics.map((m) => m.first_acquired).reduce((a, b) => (a < b ? a : b)),
      end: mosaics.map((m) => m.last_acquired).reduce((a, b) => (a > b ? a : b)),
    };
  const year = Number(key.slice(0, 4));
  if (key.length === 4) return { start: `${year}-01-01`, end: `${year}-12-31` };
  if (key.includes('Q')) {
    const first = (Number(key.slice(-1)) - 1) * 3 + 1;
    return { start: isoDay(year, first, 1), end: isoDay(year, first + 3, 0) };
  }
  const month = Number(key.slice(5, 7));
  return { start: isoDay(year, month, 1), end: isoDay(year, month + 1, 0) };
}

function calendarWindows(mosaics: PlanetMosaicOut[], period: CollectionPeriod): Window[] {
  const groups = new Map<string, PlanetMosaicOut[]>();
  for (const mosaic of mosaics) {
    const key = collectionKey(mosaic.first_acquired, period);
    groups.set(key, [...(groups.get(key) ?? []), mosaic]);
  }
  return [...groups].map(([key, group]) => ({ key, mosaics: group, ...windowSpan(key, group) }));
}

const DAY_MS = 86_400_000;
const overlapDays = (a: { start: string; end: string }, b: PlanetMosaicOut) =>
  (Math.min(Date.parse(a.end), Date.parse(b.last_acquired)) -
    Math.max(Date.parse(a.start), Date.parse(b.first_acquired))) /
    DAY_MS +
  1;

/** The cover mosaic sharing the most days with the window; the earlier one on a tie. */
function bestCover(window: Window, covers: PlanetMosaicOut[]): PlanetMosaicOut | null {
  let best: PlanetMosaicOut | null = null;
  let bestDays = 0;
  for (const cover of covers) {
    const days = overlapDays(window, cover);
    if (days > bestDays) [best, bestDays] = [cover, days];
  }
  return best;
}

/** Windows always come from the calendar. The cover is either one of the
 *  window's own mosaics or, with a cover series, its mosaic that overlaps the
 *  window most - Planet has no compositing, so a longer-period product is the
 *  closest thing to a STAC cover searched over the whole window. */
function windowCollections(
  mosaics: PlanetMosaicOut[],
  options: PlanetGenerationOptions
): PlanetCollections {
  const covers = options.coverMosaics ? usableMosaics(options.coverMosaics) : null;
  const uncovered: string[] = [];
  const partlyCovered: string[] = [];

  const collections = calendarWindows(mosaics, options.collectionPeriod).map((window) => {
    const name = window.key === 'all' ? options.seriesName : window.key;
    const slices = window.mosaics.map((m) => toSlice(m, options.renderings));
    const vizUrls = slices[0]?.vizUrls ?? [];
    const cover = covers && bestCover(window, covers);

    if (!cover) {
      if (covers) uncovered.push(name);
      const nth = covers ? 1 : options.coverNth;
      const index = Math.min(Math.max(nth, 1) - 1, slices.length - 1);
      return manualCollection(name, slices, { index, dedicated: false }, vizUrls);
    }

    if (cover.first_acquired > window.start || cover.last_acquired < window.end)
      partlyCovered.push(name);
    const coverSlice = toSlice(
      cover,
      options.renderings,
      windowName(cover.first_acquired, cover.last_acquired)
    );
    return manualCollection(name, [coverSlice, ...slices], { index: 0, dedicated: true }, vizUrls);
  });

  return { collections, uncovered, partlyCovered };
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

  return windowCollections(inRange, options);
}
