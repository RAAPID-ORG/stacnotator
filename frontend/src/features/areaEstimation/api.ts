/**
 * The seam between the wizard and the work only a server can do.
 *
 * Reading a map, attaching areas of interest and counting pixels are real
 * calls against the area estimation backend; the map lives there only while
 * the design is being written. The plan itself and the running tally of
 * annotated units are still kept locally, standing in for endpoints that do
 * not exist yet.
 */

import {
  getJob,
  linkMap,
  preprocess,
  setAreas,
  uploadMap,
  type JobOut,
  type MapOut,
} from '~/api/client';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import type { AreaEstimationPlan, PixelCensus, RasterInfo, StudyArea } from './core/plan';
import { NO_DATA_CLASS_ID, WHOLE_MAP_AREA_ID, designsOf, emptyPlan } from './core/plan';
import type { StratumSample } from './core/estimate';

const POLL_MS = 1500;
const LATENCY_MS = 450;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The generated client types a multipart file as a string, which is what the
 * schema says and not what the browser sends. Widening here keeps that one
 * disagreement at the boundary.
 */
const multipartFile = (file: File): string => file as unknown as string;

const unwrap = <T>({ data, error }: { data?: T; error?: unknown }, context: string): T => {
  if (error !== undefined || data === undefined) {
    throw new Error(extractErrorMessage(error, context));
  }
  return data;
};

export interface RasterInspection {
  raster: RasterInfo;
  /** The projection to compute areas in: the map's own when it already is one. */
  equalAreaCrs: string;
}

const rasterOf = (map: MapOut): RasterInfo => {
  const first = map.info.sources[0];
  return {
    mapId: map.id,
    name: map.sources.map((s) => s.name).join(', '),
    bands: map.info.bands.map((b) => ({
      index: b.index,
      description: b.description,
      noData: b.nodata,
    })),
    crs: first.crs_name,
    isEqualArea: map.info.is_equal_area,
    areaPerPixel: first.pixel_area_m2,
    resolutionMeters: first.is_geographic ? null : first.resolution[0],
    bbox: map.info.bbox,
  };
};

const inspectionOf = (map: MapOut): RasterInspection => ({
  raster: rasterOf(map),
  equalAreaCrs: map.info.proposed_crs,
});

/** Store a map on the backend, from a file or a URL, and read what its header says. */
export const inspectRaster = async (
  campaignId: number,
  source: File | string
): Promise<RasterInspection> => {
  const path = { campaign_id: campaignId };
  const response =
    typeof source === 'string'
      ? await linkMap({ path, body: { urls: [source] } })
      : await uploadMap({ path, body: { files: [multipartFile(source)] } });
  return inspectionOf(unwrap(response, 'Could not read the map'));
};

const areasOf = (map: MapOut): StudyArea[] =>
  (map.areas?.areas ?? []).map((a) => ({ id: a.id, name: a.name, featureCount: a.feature_count }));

/** Attach a boundary file to the map, replacing any areas it had. */
export const parseStudyAreas = async (
  campaignId: number,
  mapId: string,
  file: File
): Promise<StudyArea[]> => {
  const response = await setAreas({
    path: { campaign_id: campaignId, map_id: mapId },
    body: { file: multipartFile(file) },
  });
  return areasOf(unwrap(response, 'Could not read the area file'));
};

const censusOf = (job: JobOut, bandIndex: number): PixelCensus => {
  if (!job.result || !('band' in job.result)) {
    throw new Error('The count finished without a result');
  }
  const { grid, total, by_area } = job.result;
  return {
    bandIndex,
    crs: grid.crs,
    pixelAreaM2: grid.resolution_m * grid.resolution_m,
    byArea: { ...by_area, [WHOLE_MAP_AREA_ID]: total },
  };
};

/**
 * The zonal histogram: how many pixels of each map value fall inside each
 * area, counted on the equal-area grid. A background job on the server; this
 * waits for it, reporting progress as it goes.
 */
export const censusPixels = async (
  campaignId: number,
  mapId: string,
  bandIndex: number,
  equalAreaCrs: string,
  onProgress?: (fraction: number) => void
): Promise<PixelCensus> => {
  const started = unwrap(
    await preprocess({
      path: { campaign_id: campaignId, map_id: mapId },
      body: { band: bandIndex, crs: equalAreaCrs },
    }),
    'Could not count the map pixels'
  );
  let job = started;
  while (job.status === 'queued' || job.status === 'running') {
    onProgress?.(job.progress);
    await sleep(POLL_MS);
    job = unwrap(
      await getJob({ path: { campaign_id: campaignId, job_id: started.id } }),
      'Could not count the map pixels'
    );
  }
  if (job.status === 'failed') {
    throw new Error(job.error ?? 'Counting the map pixels failed');
  }
  onProgress?.(1);
  return censusOf(job, bandIndex);
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

/**
 * Stands in for the running tally of annotated sampling units, which no
 * endpoint serves yet. The counts are drawn from the plan's own prior so the
 * estimates the admin sees behave like real ones: wide early, tightening as
 * points come in.
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
