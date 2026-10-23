/**
 * The choices the setup wizard offers, kept as data so they can be
 * unit-tested. Their wording lives in the `areaEstimation` locale files.
 *
 * The audience is a national statistics office that has to defend a published
 * crop area, not a remote sensing researcher. Every option therefore carries a
 * plain sentence first and the statistical justification second, and uses the
 * standard vocabulary of design-based inference throughout: sampling units,
 * strata, stratum weights, user's and producer's accuracy.
 */

export type PriorFit = 'good' | 'fair' | 'weak' | 'caution';

export interface PriorSource {
  id: PriorSourceId;
  fit: PriorFit;
  /** Starting conjecture for the user's accuracy of each stratum. */
  defaultCorrectShare: number;
}

export type PriorSourceId =
  | 'last_season_map'
  | 'published_map'
  | 'expert_judgement'
  | 'held_out_test_set'
  | 'none';

export const PRIOR_SOURCES: PriorSource[] = [
  {
    id: 'last_season_map',
    fit: 'good',
    defaultCorrectShare: 0.85,
  },
  {
    id: 'published_map',
    fit: 'fair',
    defaultCorrectShare: 0.75,
  },
  {
    id: 'expert_judgement',
    fit: 'weak',
    defaultCorrectShare: 0.7,
  },
  {
    id: 'held_out_test_set',
    fit: 'caution',
    defaultCorrectShare: 0.8,
  },
  {
    id: 'none',
    fit: 'weak',
    defaultCorrectShare: 0.7,
  },
];

export const priorSource = (id: PriorSourceId): PriorSource =>
  PRIOR_SOURCES.find((s) => s.id === id) ?? PRIOR_SOURCES[PRIOR_SOURCES.length - 1];

/**
 * Only the complete absence of accuracy information forces a pilot. A weak or
 * optimistic conjecture still allocates the sample, and a poor allocation
 * costs precision rather than validity.
 */
export const requiresPilot = (id: PriorSourceId): boolean => id === 'none';

export interface PrecisionPreset {
  id: 'official' | 'national' | 'monitoring';
  cv: number;
}

/**
 * Target precision is stated as a coefficient of variation: the standard error
 * as a proportion of the estimate itself. The examples anchor it to what
 * statistical agencies actually publish.
 */
export const PRECISION_PRESETS: PrecisionPreset[] = [
  { id: 'official', cv: 0.02 },
  { id: 'national', cv: 0.05 },
  { id: 'monitoring', cv: 0.1 },
];

export const DEFAULT_SAMPLE_FLOOR = 75;
/** Sampling units the pilot buys for each stratum before the floor is applied. */
export const DEFAULT_PILOT_BUDGET_PER_CLASS = 40;

/** No stratum drops below this in the pilot, however small its weight. */
export const DEFAULT_PILOT_FLOOR_PER_CLASS = 20;
export const DEFAULT_TARGET_CV = 0.05;

/**
 * Pixel counts only stand for area on an equal-area grid, so one is always
 * chosen. The list is the usual continental choices plus a global fallback;
 * anything else can be typed in.
 */
export const EQUAL_AREA_PROJECTIONS: { code: string; name: string }[] = [
  { code: 'EPSG:6933', name: 'World Cylindrical Equal Area (global)' },
  { code: 'EPSG:3035', name: 'ETRS89 / LAEA (Europe)' },
  { code: 'EPSG:5070', name: 'NAD83 / Conus Albers (United States)' },
  { code: 'ESRI:102022', name: 'Albers Equal Area (Africa)' },
  { code: 'ESRI:102025', name: 'Albers Equal Area (North and Central Asia)' },
  { code: 'ESRI:102033', name: 'Albers Equal Area (South America)' },
  { code: 'EPSG:3577', name: 'GDA94 / Australian Albers' },
];

export const DEFAULT_EQUAL_AREA_CRS = 'EPSG:6933';
