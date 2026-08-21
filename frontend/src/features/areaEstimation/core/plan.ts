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
import { priorFromCorrectShares, priorSharesOfClass } from './prior';
import {
  DEFAULT_PILOT_PER_STRATUM,
  DEFAULT_SAMPLE_FLOOR,
  DEFAULT_TARGET_CV,
  priorSource,
  requiresPilot,
  type PriorSourceId,
} from './guidance';

/** How named areas of interest are reported on. */
export type DomainMode = 'combined' | 'per_area';

/** What happens to pixels the map does not classify. */
export type NoDataHandling = 'exclude' | 'stratum';

export const NO_DATA_CLASS_ID = '__nodata__';

export interface RasterBand {
  index: number;
  description: string | null;
}

export interface RasterInfo {
  name: string;
  bands: RasterBand[];
  crs: string;
  /** Areas from pixel counts are only meaningful on an equal-area grid. */
  isEqualArea: boolean;
  /** Square metres covered by one pixel. */
  areaPerPixel: number;
  resolutionMeters: number;
}

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
  byArea: Record<string, Record<string, number>>;
}

export interface ReportingClass {
  id: string;
  name: string;
  /** Raster values folded into this class. Merging happens here, not in the map. */
  values: number[];
}

export interface AreaEstimationPlan {
  raster: RasterInfo | null;
  bandIndex: number;
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
  pilotPerStratum: number;
  /** Hand-edited sample sizes, by stratum id, winning over the computed ones. */
  overrides: Record<string, number>;
  /** Set when the design has been turned into a sample the campaign works on. */
  activatedAt: string | null;
  /**
   * The task set the sample lives in. It belongs to the design: nothing else
   * may add tasks to it, because every task in it carries a known inclusion
   * probability and an ad-hoc addition would break that.
   */
  taskSetId: number | null;
}

export const emptyPlan = (): AreaEstimationPlan => ({
  raster: null,
  bandIndex: 1,
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
  pilotPerStratum: DEFAULT_PILOT_PER_STRATUM,
  overrides: {},
  activatedAt: null,
  taskSetId: null,
});

/** A population that gets its own precision target and its own strata. */
export interface Domain {
  id: string;
  name: string;
  strata: DomainStratum[];
}

export interface DomainStratum extends PlannedStratum {
  classId: string;
  className: string;
  isNoData: boolean;
}

export const stratumId = (domainId: string, classId: string) => `${domainId}::${classId}`;

const pixelsOf = (
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

/**
 * Strata come out of the plan, never out of the map directly: a reporting
 * class is one stratum, and if areas are reported separately each area gets
 * its own copy of every stratum.
 */
export const domainsOf = (plan: AreaEstimationPlan): Domain[] => {
  const groups =
    plan.domainMode === 'per_area'
      ? plan.areas.map((a) => ({ id: a.id, name: a.name, areaIds: [a.id] }))
      : [{ id: 'all', name: 'Whole study area', areaIds: plan.areas.map((a) => a.id) }];

  return groups.map((group) => {
    const strata: DomainStratum[] = plan.classes.map((cls) => ({
      id: stratumId(group.id, cls.id),
      classId: cls.id,
      className: cls.name,
      isNoData: false,
      pixelCount: pixelsOf(plan.census, group.areaIds, cls.values),
      targetShare: 0,
    }));
    if (plan.noDataHandling === 'stratum' && plan.noDataValues.length > 0) {
      strata.push({
        id: stratumId(group.id, NO_DATA_CLASS_ID),
        classId: NO_DATA_CLASS_ID,
        className: 'Unmapped',
        isNoData: true,
        pixelCount: pixelsOf(plan.census, group.areaIds, plan.noDataValues),
        targetShare: 0,
      });
    }
    return { id: group.id, name: group.name, strata: withPrior(strata, plan) };
  });
};

/**
 * Fill in each stratum's prior belief about the target class. Unmapped pixels
 * carry no assumption of being right, so their prior is the leakage the other
 * classes imply rather than an accuracy of their own.
 */
const withPrior = (strata: DomainStratum[], plan: AreaEstimationPlan): DomainStratum[] => {
  if (!plan.targetClassId) return strata;
  const weights = stratumWeights(strata);
  const correct = strata.map((s) =>
    s.isNoData ? 0 : (plan.correctShares[s.classId] ?? defaultCorrectShare(plan))
  );
  const prior = priorFromCorrectShares(
    strata.map((s) => s.classId),
    weights,
    correct
  );
  const shares = priorSharesOfClass(prior, plan.targetClassId);
  return strata.map((s, i) => ({ ...s, targetShare: shares[i] }));
};

export const defaultCorrectShare = (plan: AreaEstimationPlan): number =>
  priorSource(plan.priorSourceId).defaultCorrectShare;

export interface DomainDesign {
  domain: Domain;
  allocation: StratumAllocation[];
  total: number;
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
  const floor = pilot ? plan.pilotPerStratum : plan.sampleFloor;
  const budget = pilot
    ? plan.pilotPerStratum * domain.strata.length
    : sampleSizeForTargetCv(domain.strata, rule, plan.targetCv);

  const allocation = applyOverrides(plan, allocate(domain.strata, budget, rule, floor));
  return {
    domain,
    allocation,
    total: totalSampleSize(allocation),
    precision: anticipatedPrecision(domain.strata, allocation),
    perClass: perClassPrecision(plan, domain, allocation),
  };
};

/**
 * Anticipated precision of every reporting class, not just the target. A
 * design tuned for one crop can leave another one far too thin, and the user
 * should see that before annotating thousands of points.
 */
const perClassPrecision = (
  plan: AreaEstimationPlan,
  domain: Domain,
  allocation: readonly StratumAllocation[]
) => {
  const weights = stratumWeights(domain.strata);
  const correct = domain.strata.map((s) =>
    s.isNoData ? 0 : (plan.correctShares[s.classId] ?? defaultCorrectShare(plan))
  );
  const prior = priorFromCorrectShares(
    domain.strata.map((s) => s.classId),
    weights,
    correct
  );
  return domain.strata
    .filter((s) => !s.isNoData)
    .map((target) => {
      const shares = priorSharesOfClass(prior, target.classId);
      const strata = domain.strata.map((s, i) => ({ ...s, targetShare: shares[i] }));
      return {
        classId: target.classId,
        className: target.className,
        precision: anticipatedPrecision(strata, allocation),
      };
    });
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

/** Raster values the user has not yet put into a class or marked unmapped. */
export const unassignedValues = (plan: AreaEstimationPlan): MapValue[] => {
  const taken = new Set<number>([...plan.noDataValues, ...plan.classes.flatMap((c) => c.values)]);
  return plan.values.filter((v) => !taken.has(v.value));
};

/**
 * Pixels the estimate will cover. Defined by the map values in scope rather
 * than by class membership, so it is already the right number while the
 * reporting classes are still being edited.
 */
export const studyAreaPixels = (plan: AreaEstimationPlan): number => {
  const inScope = plan.values
    .filter((v) => plan.noDataHandling === 'stratum' || !plan.noDataValues.includes(v.value))
    .map((v) => v.value);
  return pixelsOf(
    plan.census,
    plan.areas.map((a) => a.id),
    inScope
  );
};

export interface StepIssue {
  step: PlanStep;
  message: string;
}

export type PlanStep = 'data' | 'classes' | 'target' | 'prior' | 'design';

export const PLAN_STEPS: { id: PlanStep; name: string }[] = [
  { id: 'data', name: 'Map & areas' },
  { id: 'classes', name: 'Reporting classes' },
  { id: 'target', name: 'Target & precision' },
  { id: 'prior', name: 'What we know' },
  { id: 'design', name: 'Sample design' },
];

export const validatePlan = (plan: AreaEstimationPlan): StepIssue[] => {
  const issues: StepIssue[] = [];
  const add = (step: PlanStep, message: string) => issues.push({ step, message });

  if (!plan.raster) add('data', 'Add the map that will be used to stratify the sample.');
  if (plan.areas.length === 0) add('data', 'Add at least one area of interest.');
  if (plan.raster && !plan.census) add('data', 'Count the map’s pixels inside the areas.');
  if (plan.values.some((v) => !v.label.trim()))
    add('data', 'Give every map value a name so the classes can be read.');

  if (plan.classes.length < 2)
    add('classes', 'Define at least two reporting classes; one class cannot be estimated alone.');
  if (plan.classes.some((c) => c.values.length === 0))
    add('classes', 'Every reporting class needs at least one map value.');
  if (unassignedValues(plan).length > 0)
    add('classes', 'Put every map value into a class, or mark it as unmapped.');

  if (!plan.targetClassId) add('target', 'Choose the class the sample size should be sized for.');
  if (plan.targetCv <= 0 || plan.targetCv >= 1)
    add('target', 'Target precision must be between 0 and 100 percent.');

  if (plan.priorSourceId === 'held_out_test_set')
    add('prior', 'A held-out test set cannot be used; pick another source or run a pilot.');

  const designs = designsOf(plan);
  if (plan.classes.length >= 2 && totalPoints(designs) === 0)
    add('design', 'The design has no sample points; check the pixel counts and the target.');

  return issues;
};

export const issuesForStep = (issues: readonly StepIssue[], step: PlanStep): StepIssue[] =>
  issues.filter((i) => i.step === step);
