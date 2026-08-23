/**
 * The seam between the wizard and the work only a server can do: reading a
 * raster's bands, counting pixels inside the areas of interest, and keeping
 * the plan and its running estimate.
 *
 * Nothing here is the real implementation. Every function stands in for a
 * backend endpoint that does not exist yet, and answers from deterministic
 * fixtures so the interface can be exercised and reviewed first. Replacing
 * this file with generated client calls is the whole of the frontend's part
 * in the backend work.
 */

import type { AreaEstimationPlan, MapValue, PixelCensus, RasterInfo, StudyArea } from './core/plan';
import { NO_DATA_CLASS_ID, designsOf, emptyPlan, proposedEqualAreaCrs } from './core/plan';
import { DEFAULT_EQUAL_AREA_CRS } from './core/guidance';
import type { StratumSample } from './core/estimate';

const LATENCY_MS = 450;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deterministic PRNG so the same fixture always produces the same numbers. */
const seededRandom = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const CROP_LEGEND: MapValue[] = [
  { value: 0, label: 'Nodata' },
  { value: 1, label: 'Winter wheat' },
  { value: 2, label: 'Rapeseed' },
  { value: 3, label: 'Other winter cereals' },
  { value: 4, label: 'Summer crops' },
  { value: 5, label: 'Non-cropland' },
];

/** Rough national shares, before the per-area jitter below. */
const LEGEND_SHARES: Record<number, number> = {
  0: 0.18,
  1: 0.14,
  2: 0.03,
  3: 0.05,
  4: 0.28,
  5: 0.32,
};

const REGION_NAMES = ['Northern region', 'Central region', 'Southern region', 'Eastern region'];

export interface RasterInspection {
  raster: RasterInfo;
  /** The projection to compute areas in: the map's own when it already is one. */
  equalAreaCrs: string;
  /** Per band: the legend the file carries, empty when it has no metadata. */
  legendByBand: Record<number, MapValue[]>;
  noDataValuesByBand: Record<number, number[]>;
}

/** What the fixture map covers, and therefore what its projection is sized to. */
const FIXTURE_BBOX = { west: 22.1, south: 44.4, east: 40.2, north: 52.4 };

export const inspectRaster = async (fileName: string): Promise<RasterInspection> => {
  await sleep(LATENCY_MS);
  // A geographic CRS is the common mistake: pixel areas vary with latitude, so
  // pixel counts are not proportional to area. Surfaced rather than corrected.
  const isEqualArea = !/4326|wgs ?84|latlon/i.test(fileName);
  const raster = {
    name: fileName,
    bands: [
      { index: 1, description: 'crop_type' },
      { index: 2, description: 'crop_type_no_legend' },
    ],
    crs: isEqualArea ? 'EPSG:6933 (World Equal Area)' : 'EPSG:4326 (WGS 84 lat/lon)',
    isEqualArea,
    areaPerPixel: 100,
    resolutionMeters: 10,
    bbox: FIXTURE_BBOX,
  };
  return {
    equalAreaCrs: proposedEqualAreaCrs(raster) ?? DEFAULT_EQUAL_AREA_CRS,
    raster,
    legendByBand: { 1: CROP_LEGEND, 2: [] },
    noDataValuesByBand: { 1: [0], 2: [] },
  };
};

export const parseStudyAreas = async (fileName: string): Promise<StudyArea[]> => {
  await sleep(LATENCY_MS);
  const base = fileName.replace(/\.[^.]+$/, '');
  if (/region|admin|oblast|province|district/i.test(fileName)) {
    return REGION_NAMES.map((name, i) => ({ id: `area-${i + 1}`, name, featureCount: 1 }));
  }
  return [{ id: 'area-1', name: base || 'Study area', featureCount: 1 }];
};

/**
 * The zonal histogram: how many pixels of each map value fall inside each
 * area. This is the only place the map's own numbers enter the design.
 */
export const censusPixels = async (
  raster: RasterInfo,
  bandIndex: number,
  areas: readonly StudyArea[],
  values: readonly MapValue[]
): Promise<PixelCensus> => {
  await sleep(LATENCY_MS);
  const byArea: Record<string, Record<string, number>> = {};
  areas.forEach((area, areaIndex) => {
    const random = seededRandom(`${raster.name}|${bandIndex}|${area.id}`);
    const totalPixels = 40_000_000 + Math.round(random() * 30_000_000) * (areaIndex === 0 ? 2 : 1);
    const shares = values.map((v) => (LEGEND_SHARES[v.value] ?? 0.1) * (0.6 + random() * 0.8));
    const sum = shares.reduce((a, b) => a + b, 0);
    byArea[area.id] = Object.fromEntries(
      values.map((v, i) => [String(v.value), Math.round((shares[i] / sum) * totalPixels)])
    );
  });
  return { bandIndex, byArea };
};

// A design belongs to the task set holding its sample, not to the campaign:
// a campaign can run several estimates, and each is its own set of points.
const PREFIX = 'stacnotator.areaEstimation';
const storageKey = (campaignId: number, taskSetId: number) =>
  `${PREFIX}.${campaignId}.${taskSetId}`;

/** Task sets in this campaign that carry an area estimation design. */
export const listPlannedTaskSets = async (campaignId: number): Promise<number[]> => {
  const prefix = `${PREFIX}.${campaignId}.`;
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(prefix))
    .map((key) => Number(key.slice(prefix.length)))
    .filter((id) => Number.isFinite(id));
};

export const loadPlan = async (
  campaignId: number,
  taskSetId: number
): Promise<AreaEstimationPlan | null> => {
  const raw = localStorage.getItem(storageKey(campaignId, taskSetId));
  if (!raw) return null;
  try {
    // A plan stored before a field existed still has to load. Merging onto the
    // current shape covers the plan's own fields; it is shallow, so a field
    // added inside a nested shape has to be optional there and stay optional
    // until this is a real endpoint with a schema behind it.
    return { ...emptyPlan(), ...(JSON.parse(raw) as Partial<AreaEstimationPlan>) };
  } catch {
    return null;
  }
};

export const savePlan = async (
  campaignId: number,
  taskSetId: number,
  plan: AreaEstimationPlan
): Promise<void> => {
  // Committed before returning: the wizard saves on every edit, and a write
  // that is still pending when the user navigates away is a lost plan.
  localStorage.setItem(storageKey(campaignId, taskSetId), JSON.stringify(plan));
};

/** Attach an empty design to a task set, making it an area estimation set. */
export const createPlan = async (campaignId: number, taskSetId: number): Promise<void> => {
  await savePlan(campaignId, taskSetId, emptyPlan());
};

export const clearPlan = async (campaignId: number, taskSetId: number): Promise<void> => {
  localStorage.removeItem(storageKey(campaignId, taskSetId));
};

export interface Progress {
  /** Sampling units drawn per domain, keyed by stratum id. */
  samples: Record<string, StratumSample[]>;
  annotated: number;
  planned: number;
}

/**
 * Stands in for the running tally of annotated sampling units. The counts are
 * drawn from the plan's own prior so the estimates the admin sees behave like
 * real ones: wide early, tightening as points come in.
 */
export const loadProgress = async (
  taskSetId: number,
  plan: AreaEstimationPlan,
  completedFraction: number
): Promise<Progress> => {
  await sleep(LATENCY_MS / 2);
  const samples: Record<string, StratumSample[]> = {};
  let annotated = 0;
  let planned = 0;

  designsOf(plan).forEach((design) => {
    const byId = new Map(design.allocation.map((a) => [a.id, a.n]));
    samples[design.domain.id] = design.domain.strata.map((stratum) => {
      const target = byId.get(stratum.id) ?? 0;
      const done = Math.round(target * completedFraction);
      planned += target;
      annotated += done;
      return {
        id: stratum.classId,
        pixelCount: stratum.pixelCount,
        counts: drawCounts(plan, design.domain.strata, stratum.classId, done, taskSetId),
      };
    });
  });

  return { samples, annotated, planned };
};

/** Split `n` annotated points of one stratum over the reference classes. */
const drawCounts = (
  plan: AreaEstimationPlan,
  strata: readonly { classId: string; pixelCount: number; isNoData: boolean }[],
  classId: string,
  n: number,
  seed: number
): Record<string, number> => {
  const random = seededRandom(`${seed}|${classId}|${n}`);
  const correct = plan.correctShares[classId] ?? 0.85;
  const others = strata.filter((s) => s.classId !== classId && !s.isNoData);
  const otherPixels = others.reduce((sum, s) => sum + s.pixelCount, 0);

  const counts: Record<string, number> = {};
  let placed = 0;
  others.forEach((s) => {
    const share = otherPixels > 0 ? s.pixelCount / otherPixels : 1 / Math.max(1, others.length);
    const c = Math.round(n * (1 - correct) * share * (0.5 + random()));
    counts[s.classId] = c;
    placed += c;
  });
  counts[classId] = Math.max(0, n - placed);
  if (classId === NO_DATA_CLASS_ID) counts[classId] = 0;
  return counts;
};
