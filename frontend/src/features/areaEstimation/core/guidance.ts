/**
 * The explanatory content of the setup wizard, kept as data so the wording is
 * in one place and the choices it offers can be unit-tested.
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
  title: string;
  /** What the user recognises themselves in. */
  summary: string;
  fit: PriorFit;
  fitLabel: string;
  /** Why the fit is what it is, in the user's terms. */
  rationale: string;
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
    title: 'An accuracy assessment of last season of this same map',
    summary: 'This map was produced before and assessed against reference data.',
    fit: 'good',
    fitLabel: 'Strong basis',
    rationale:
      'The same method over the same landscape tends to make the same kinds of error, so last season’s estimated user’s accuracies are the best available conjecture for this season. If that assessment used a probability sample of the map, its accuracies describe the whole mapped population and carry over directly.',
    defaultCorrectShare: 0.85,
  },
  {
    id: 'published_map',
    title: 'A published accuracy assessment of a comparable map',
    summary: 'Another producer mapped this region and published assessed accuracies.',
    fit: 'fair',
    fitLabel: 'Reasonable basis',
    rationale:
      'The landscape is right but the classifier is not yours, so the accuracies transfer only approximately. Check that the published figures come from a probability sample, and that the class definitions match yours: per-class accuracies are comparable only when the classes are.',
    defaultCorrectShare: 0.75,
  },
  {
    id: 'expert_judgement',
    title: 'Expert judgement',
    summary: 'Analysts familiar with this map and this region conjecture its accuracy.',
    fit: 'weak',
    fitLabel: 'Weak but usable',
    rationale:
      'Acceptable when the experts have actually inspected this map’s output. It is a conjecture rather than an estimate, so keep the per-stratum minimum in place and expect to revise the allocation once reference labels start arriving.',
    defaultCorrectShare: 0.7,
  },
  {
    id: 'held_out_test_set',
    title: 'A held-out test set from the map’s own development',
    summary: 'Labelled units set aside while the classifier was trained.',
    fit: 'caution',
    fitLabel: 'Planning only',
    rationale:
      'Admissible here, and only here, because these conjectures are used solely to allocate the sample across strata. Allocation affects precision, never bias, so an optimistic conjecture cannot corrupt the published area. Two pitfalls make the same numbers inadmissible anywhere else. First, a test set is almost never a probability sample of the mapped population: it sits where reference data was convenient to collect, so accuracies computed from it have unknown inclusion probabilities and are typically optimistic by a wide margin. Second, it comes from the map’s own development, so it lets the classifier grade itself. Treat the values below as an upper bound, consider entering figures several points lower, and do not publish accuracies from this source - the assessment this campaign produces is the one you report.',
    defaultCorrectShare: 0.8,
  },
  {
    id: 'none',
    title: 'No usable accuracy information',
    summary: 'This map has never been assessed against reference data.',
    fit: 'weak',
    fitLabel: 'Start with a pilot',
    rationale:
      'A pilot measures the accuracies instead of conjecturing them. Pilot units are drawn from the same strata by the same protocol, so they remain part of the final sample and enter the estimator with the same weights; nothing is discarded.',
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
  cv: number;
  title: string;
  example: string;
}

/**
 * Target precision is stated as a coefficient of variation: the standard error
 * as a proportion of the estimate itself. The examples anchor it to what
 * statistical agencies actually publish.
 */
export const PRECISION_PRESETS: PrecisionPreset[] = [
  {
    cv: 0.02,
    title: 'Official national statistics',
    example:
      'What USDA’s National Agricultural Statistics Service targets for maize, soybean and winter wheat area. Expensive: it needs thousands of sampling units.',
  },
  {
    cv: 0.05,
    title: 'National reporting, main crops',
    example:
      'Good enough to publish a national planted area and to detect a real year-on-year change. The usual choice for a ministry’s headline crop.',
  },
  {
    cv: 0.1,
    title: 'Programme monitoring',
    example:
      'Enough to track a trend, size a subsidy programme, or report a minor crop. A 1.0 Mha estimate would carry roughly ±0.2 Mha.',
  },
];

/**
 * Why every stratum gets a minimum sample size regardless of its weight.
 * Shown next to the floor control.
 */
export const SAMPLE_FLOOR_RATIONALE =
  'A stratum with a small weight receives almost no sampling units under proportional allocation, and a handful of units cannot support a statement about that class. Olofsson et al. (2014) recommend 50 to 100 units in each rare stratum. Raising the floor widens the intervals of the other strata only if units are taken away from them, which this tool does not do: it adds to the total sample size instead.';

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
