/**
 * The area estimation plan: everything the campaign admin decides before the
 * first point is drawn, and the derivations that turn those decisions into a
 * sampling design.
 *
 * Pure data and functions. The wizard edits a plan, the design panel reads
 * what falls out of it, and the backend will eventually store exactly this.
 */

import {
  allocate,
  anticipatedPrecision,
  sampleSizeForTargetCv,
  stratumWeights,
  totalSampleSize,
  type AllocationRule,
  type PlannedStratum,
  type Precision,
  type StratumAllocation,
} from './design';
import { priorFromCorrectShares, priorSharesOfClass, type PriorMatrix } from './prior';
import {
  DEFAULT_EQUAL_AREA_CRS,
  DEFAULT_PILOT_BUDGET_PER_CLASS,
  DEFAULT_PILOT_FLOOR_PER_CLASS,
  DEFAULT_SAMPLE_FLOOR,
  DEFAULT_TARGET_CV,
  priorSource,
  requiresPilot,
  type PriorSourceId,
} from './guidance';

/** How named areas of interest are reported on. */
export type DomainMode = 'combined' | 'per_area';

/** What happens to the map’s nodata pixels. */
export type NoDataHandling = 'exclude' | 'stratum';

export const NO_DATA_CLASS_ID = '__nodata__';

export interface RasterBand {
  index: number;
  description: string | null;
  /** The file's own nodata for this band, if it declares one. */
  noData: number | null;
}

/** Geographic extent in WGS84 degrees. */
export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface RasterInfo {
  /**
   * The map as the backend holds it while the design is being written. Absent
   * from a plan stored before maps were uploaded, which then has to be replaced
   * before it can be counted again.
   */
  mapId?: string;
  name: string;
  bands: RasterBand[];
  crs: string;
  /** Areas from pixel counts are only meaningful on an equal-area grid. */
  isEqualArea: boolean;
  /** Square metres covered by one pixel of the file's own grid; null when it is in degrees. */
  areaPerPixel: number | null;
  resolutionMeters: number | null;
  /**
   * What the map covers, which is what the projection is proposed for.
   * Optional because a plan stored before this field existed has no extent to
   * offer, and a projection can only be proposed for a map we can measure.
   */
  bbox?: Bbox;
}

const round2 = (value: number) => Number(value.toFixed(2));

/**
 * A Lambert azimuthal equal-area projection centred on a point.
 *
 * LAEA preserves area everywhere on the grid, not only near its centre, so the
 * centre affects how distorted shapes look and never how much a pixel counts
 * for. That is why proposing one from the map's own extent is enough: it needs
 * to be roughly right, not exact.
 */
export const laeaFor = (lat: number, lon: number): string =>
  `+proj=laea +lat_0=${round2(lat)} +lon_0=${round2(lon)} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;

/** The equal-area projection to offer for a map, or null when its extent is unknown. */
export const proposedEqualAreaCrs = ({ bbox }: RasterInfo): string | null =>
  bbox ? laeaFor((bbox.south + bbox.north) / 2, (bbox.west + bbox.east) / 2) : null;

/**
 * Whether a projection is one whose pixels plainly do not carry equal area.
 * Deliberately a short blacklist rather than a validator: PROJ cannot be
 * resolved in the browser, so this catches the mistakes that actually happen
 * (leaving the map in lat/lon, or reaching for web mercator) and stays quiet
 * about everything else.
 */
export const looksNotEqualArea = (crs: string): boolean =>
  /(^|[^0-9])(4326|3857|900913)([^0-9]|$)/.test(crs) ||
  /\+proj=(longlat|merc|utm|tmerc|lcc|stere|somerc)\b/i.test(crs);

export interface MapValue {
  value: number;
  /** From the raster's own category names when it has them, else typed in. */
  label: string;
}

export interface StudyArea {
  id: string;
  name: string;
  featureCount: number;
}

/** Pixels per raster value, per study area, for the selected band. */
export interface PixelCensus {
  bandIndex: number;
  /** The equal-area grid the pixels were counted on, and what one of them covers. */
  crs: string;
  pixelAreaM2: number;
  byArea: Record<string, Record<string, number>>;
}

/** Square metres one counted pixel stands for; the file's own only until a count exists. */
export const pixelAreaOf = (plan: AreaEstimationPlan): number =>
  plan.census?.pixelAreaM2 ?? plan.raster?.areaPerPixel ?? 0;

export interface ReportingClass {
  id: string;
  name: string;
  /** Raster values folded into this class. Merging happens here, not in the map. */
  values: number[];
}

export interface AreaEstimationPlan {
  raster: RasterInfo | null;
  bandIndex: number;
  /**
   * The equal-area projection pixel areas are computed in. Derived from the
   * map, but a statistics office reporting in a national projection will want
   * to say so, which is why it stays editable.
   */
  equalAreaCrs: string;
  values: MapValue[];
  noDataValues: number[];
  noDataHandling: NoDataHandling;
  areas: StudyArea[];
  census: PixelCensus | null;
  domainMode: DomainMode;
  classes: ReportingClass[];
  targetClassId: string | null;
  targetCv: number;
  priorSourceId: PriorSourceId;
  /** Per reporting class: the share of it the map is believed to get right. */
  correctShares: Record<string, number>;
  allocationRule: AllocationRule;
  sampleFloor: number;
  /** Points the pilot buys per class, spread by area. */
  pilotBudgetPerClass: number;
  /** The pilot's own floor, below which no class may fall. */
  pilotFloorPerClass: number;
  /** Hand-edited sample sizes, by stratum id, winning over the computed ones. */
  overrides: Record<string, number>;
  /** Set when the design has been turned into a sample the campaign works on. */
  activatedAt: string | null;
}

export const emptyPlan = (): AreaEstimationPlan => ({
  raster: null,
  bandIndex: 1,
  equalAreaCrs: DEFAULT_EQUAL_AREA_CRS,
  values: [],
  noDataValues: [],
  noDataHandling: 'exclude',
  areas: [],
  census: null,
  domainMode: 'combined',
  classes: [],
  targetClassId: null,
  targetCv: DEFAULT_TARGET_CV,
  priorSourceId: 'none',
  correctShares: {},
  allocationRule: 'neyman',
  sampleFloor: DEFAULT_SAMPLE_FLOOR,
  pilotBudgetPerClass: DEFAULT_PILOT_BUDGET_PER_CLASS,
  pilotFloorPerClass: DEFAULT_PILOT_FLOOR_PER_CLASS,
  overrides: {},
  activatedAt: null,
});

/** A population that gets its own precision target and its own strata. */
export interface Domain {
  id: string;
  name: string;
  strata: DomainStratum[];
  /** The hypothesised error matrix the strata's priors were read from. */
  prior: PriorMatrix;
}

export interface DomainStratum extends PlannedStratum {
  classId: string;
  className: string;
  isNoData: boolean;
}

export const stratumId = (domainId: string, classId: string) => `${domainId}::${classId}`;

const countPixels = (
  census: PixelCensus | null,
  areaIds: readonly string[],
  values: readonly number[]
): number => {
  if (!census) return 0;
  return areaIds.reduce((sum, areaId) => {
    const counts = census.byArea[areaId] ?? {};
    return sum + values.reduce((inner, v) => inner + (counts[String(v)] ?? 0), 0);
  }, 0);
};

/** The one area an estimate covers when no boundary file was uploaded. */
export const WHOLE_MAP_AREA_ID = 'whole-map';

/**
 * Areas of interest are optional: a map that already covers exactly what is
 * being reported on needs no boundary. Standing in one synthetic area for that
 * case keeps the census, the domains and the stratum weights on a single path
 * instead of forking every one of them on `areas.length`.
 */
export const reportingAreas = (plan: AreaEstimationPlan): StudyArea[] =>
  plan.areas.length > 0
    ? plan.areas
    : [{ id: WHOLE_MAP_AREA_ID, name: 'The whole map', featureCount: 1 }];

/** Pixels the census counted for a set of map values, across every area. */
/**
 * The distinct values the count found, in order, keeping the names already
 * given to any of them. The file carries no class list, so this is where the
 * values to name come from.
 */
export const valuesOfCensus = (census: PixelCensus, named: readonly MapValue[]): MapValue[] => {
  const labels = new Map(named.map((v) => [v.value, v.label]));
  const found = new Set<number>();
  Object.values(census.byArea).forEach((counts) =>
    Object.keys(counts).forEach((value) => found.add(Number(value)))
  );
  return [...found]
    .sort((a, b) => a - b)
    .map((value) => ({ value, label: labels.get(value) ?? '' }));
};

export const pixelsFor = (plan: AreaEstimationPlan, values: readonly number[]): number =>
  countPixels(
    plan.census,
    reportingAreas(plan).map((a) => a.id),
    values
  );

/**
 * Strata come out of the plan, never out of the map directly: a reporting
 * class is one stratum, and if areas are reported separately each area gets
 * its own copy of every stratum.
 */
export const domainsOf = (plan: AreaEstimationPlan): Domain[] => {
  const areas = reportingAreas(plan);
  const groups =
    plan.domainMode === 'per_area'
      ? areas.map((a) => ({ id: a.id, name: a.name, areaIds: [a.id] }))
      : [{ id: 'all', name: 'Whole study area', areaIds: areas.map((a) => a.id) }];

  return groups.map((group) => {
    const strata: DomainStratum[] = plan.classes.map((cls) => ({
      id: stratumId(group.id, cls.id),
      classId: cls.id,
      className: cls.name,
      isNoData: false,
      pixelCount: countPixels(plan.census, group.areaIds, cls.values),
      targetShare: 0,
    }));
    if (plan.noDataHandling === 'stratum' && plan.noDataValues.length > 0) {
      strata.push({
        id: stratumId(group.id, NO_DATA_CLASS_ID),
        classId: NO_DATA_CLASS_ID,
        className: 'Nodata',
        isNoData: true,
        pixelCount: countPixels(plan.census, group.areaIds, plan.noDataValues),
        targetShare: 0,
      });
    }
    const prior = priorMatrixFor(plan, strata);
    const shares = plan.targetClassId
      ? priorSharesOfClass(prior, plan.targetClassId)
      : strata.map(() => 0);
    return {
      id: group.id,
      name: group.name,
      prior,
      strata: strata.map((s, i) => ({ ...s, targetShare: shares[i] })),
    };
  });
};

/**
 * What the plan believes this domain's map looks like. Nodata pixels carry
 * no assumption of being right, so their row is pure leakage from the classes
 * around them rather than an accuracy of their own.
 */
const priorMatrixFor = (plan: AreaEstimationPlan, strata: readonly DomainStratum[]): PriorMatrix =>
  priorFromCorrectShares(
    strata.map((s) => s.classId),
    stratumWeights(strata),
    strata.map((s) =>
      s.isNoData ? 0 : (plan.correctShares[s.classId] ?? defaultCorrectShare(plan))
    )
  );

export const defaultCorrectShare = (plan: AreaEstimationPlan): number =>
  priorSource(plan.priorSourceId).defaultCorrectShare;

export interface DomainDesign {
  domain: Domain;
  allocation: StratumAllocation[];
  total: number;
  /**
   * The budget the allocation was asked for, before the floor lifted it. Only
   * the same request reproduces the same allocation, which is what lets the
   * precision curve put its marker exactly on this design.
   */
  requestedTotal: number;
  /** Precision of the target class within this domain, under the prior. */
  precision: Precision;
  /** What each reporting class is expected to achieve, target class included. */
  perClass: { classId: string; className: string; precision: Precision }[];
}

/** Whether the plan can compute a design at all, or must pilot its way to one. */
export const planNeedsPilot = (plan: AreaEstimationPlan): boolean =>
  requiresPilot(plan.priorSourceId);

const applyOverrides = (
  plan: AreaEstimationPlan,
  allocation: StratumAllocation[]
): StratumAllocation[] => allocation.map((a) => ({ id: a.id, n: plan.overrides[a.id] ?? a.n }));

/**
 * The design for one domain. Under a pilot the sample size is a flat budget
 * per stratum spread by area, because there is no prior to optimise against.
 */
export const designForDomain = (plan: AreaEstimationPlan, domain: Domain): DomainDesign => {
  const pilot = planNeedsPilot(plan);
  const rule: AllocationRule = pilot ? 'proportional' : plan.allocationRule;
  const floor = pilot ? plan.pilotFloorPerClass : plan.sampleFloor;
  const budget = pilot
    ? plan.pilotBudgetPerClass * domain.strata.length
    : sampleSizeForTargetCv(domain.strata, rule, plan.targetCv);

  const allocation = applyOverrides(plan, allocate(domain.strata, budget, rule, floor));
  return {
    domain,
    allocation,
    total: totalSampleSize(allocation),
    requestedTotal: budget,
    precision: anticipatedPrecision(domain.strata, allocation),
    perClass: perClassPrecision(domain, allocation),
  };
};

/**
 * Anticipated precision of every reporting class, not just the target. A
 * design tuned for one crop can leave another one far too thin, and the user
 * should see that before annotating thousands of points.
 */
const perClassPrecision = (domain: Domain, allocation: readonly StratumAllocation[]) =>
  domain.strata
    .filter((s) => !s.isNoData)
    .map((target) => {
      const shares = priorSharesOfClass(domain.prior, target.classId);
      const strata = domain.strata.map((s, i) => ({ ...s, targetShare: shares[i] }));
      return {
        classId: target.classId,
        className: target.className,
        precision: anticipatedPrecision(strata, allocation),
      };
    });

export interface CurvePoint {
  /** Total sample size actually drawn, after the per-class floor is applied. */
  total: number;
  cv: number;
}

export interface CurveSeries {
  classId: string;
  className: string;
  points: CurvePoint[];
}

/**
 * How each class's precision improves as the sample grows, under the current
 * rule and floor. This is the shape of the whole trade-off: precision falls
 * with the square root of the sample, so the curve is what tells a user that
 * halving the interval costs four times the points, without them having to
 * know that. Hand-edited sample sizes are ignored, since the curve describes
 * the rule rather than one point chosen off it.
 */
export const precisionCurves = (
  plan: AreaEstimationPlan,
  domain: Domain,
  requestedTotals: readonly number[]
): CurveSeries[] => {
  const pilot = planNeedsPilot(plan);
  const rule: AllocationRule = pilot ? 'proportional' : plan.allocationRule;
  const floor = pilot ? plan.pilotFloorPerClass : plan.sampleFloor;

  const byTotal = new Map<number, { classId: string; className: string; precision: Precision }[]>();
  for (const requested of requestedTotals) {
    const allocation = allocate(domain.strata, requested, rule, floor);
    const total = totalSampleSize(allocation);
    if (!byTotal.has(total)) byTotal.set(total, perClassPrecision(domain, allocation));
  }

  const totals = [...byTotal.keys()].sort((a, b) => a - b);
  return domain.strata
    .filter((s) => !s.isNoData)
    .map((stratum) => ({
      classId: stratum.classId,
      className: stratum.className,
      points: totals.flatMap((total) => {
        const cv = byTotal.get(total)?.find((c) => c.classId === stratum.classId)?.precision.cv;
        return cv !== undefined && Number.isFinite(cv) ? [{ total, cv }] : [];
      }),
    }));
};

export const designsOf = (plan: AreaEstimationPlan): DomainDesign[] =>
  domainsOf(plan).map((d) => designForDomain(plan, d));

export const totalPoints = (designs: readonly DomainDesign[]): number =>
  designs.reduce((sum, d) => sum + d.total, 0);

/**
 * The obvious starting point for reporting classes: the map's own classes,
 * one each. Merging is then an edit rather than a blank page.
 */
export const oneClassPerValue = (plan: AreaEstimationPlan): ReportingClass[] =>
  plan.values
    .filter((v) => !plan.noDataValues.includes(v.value))
    .map((v) => ({
      id: `class-${v.value}`,
      name: v.label || `Value ${v.value}`,
      values: [v.value],
    }));

/** Raster values the user has not yet put into a class or marked as nodata. */
export const unassignedValues = (plan: AreaEstimationPlan): MapValue[] => {
  const taken = new Set<number>([...plan.noDataValues, ...plan.classes.flatMap((c) => c.values)]);
  return plan.values.filter((v) => !taken.has(v.value));
};

/**
 * Pixels the estimate will cover. Defined by the map values in scope rather
 * than by class membership, so it is already the right number while the
 * reporting classes are still being edited.
 */
export const studyAreaPixels = (plan: AreaEstimationPlan): number =>
  pixelsFor(
    plan,
    plan.values
      .filter((v) => plan.noDataHandling === 'stratum' || !plan.noDataValues.includes(v.value))
      .map((v) => v.value)
  );

export interface StepIssue {
  step: PlanStep;
  message: string;
}

export type PlanStep = 'data' | 'classes' | 'prior' | 'design';

// The conjectured accuracies come before the design because the design is
// where the whole trade-off is settled, and the allocation cannot be solved
// until they are stated. Nothing about them depends on the target class.
export const PLAN_STEPS: { id: PlanStep; name: string }[] = [
  { id: 'data', name: 'Map & areas' },
  { id: 'classes', name: 'Classes & strata' },
  { id: 'prior', name: 'Map accuracy' },
  { id: 'design', name: 'Sample design' },
];

export const validatePlan = (plan: AreaEstimationPlan): StepIssue[] => {
  const issues: StepIssue[] = [];
  const add = (step: PlanStep, message: string) => issues.push({ step, message });

  if (!plan.raster) add('data', 'Add the map that will be used to stratify the sample.');
  if (!plan.equalAreaCrs.trim())
    add('data', 'Choose the equal-area projection areas are computed in.');
  if (plan.raster && !plan.census) add('data', 'Count the map’s pixels in the reporting area.');
  if (plan.values.some((v) => !v.label.trim()))
    add('data', 'Name every map class so the strata can be defined.');

  if (plan.classes.length < 2)
    add('classes', 'Define at least two reporting classes; one class cannot be estimated alone.');
  if (plan.classes.some((c) => c.values.length === 0))
    add('classes', 'Every reporting class needs at least one map class assigned to it.');
  if (unassignedValues(plan).length > 0)
    add('classes', 'Assign every map class to a stratum, or mark it as nodata.');

  // A pilot is sized by a flat budget per class, so it needs no target yet;
  // the target is chosen when the pilot's results size the full design.
  if (!plan.targetClassId && !planNeedsPilot(plan))
    add('design', 'Choose the target class the sample size is solved for.');
  if (plan.targetCv <= 0 || plan.targetCv >= 1)
    add('design', 'Target precision must be between 0 and 100 percent.');

  const designs = designsOf(plan);
  if (plan.classes.length >= 2 && totalPoints(designs) === 0)
    add('design', 'The design has no sampling units; check the pixel counts and the target class.');

  return issues;
};

export const issuesForStep = (issues: readonly StepIssue[], step: PlanStep): StepIssue[] =>
  issues.filter((i) => i.step === step);
