/**
 * The explanatory content of the setup wizard, kept as data so the wording is
 * in one place and the choices it offers can be unit-tested.
 *
 * The audience is a statistics office that wants a defensible crop area for a
 * country, not a remote sensing researcher. Every option therefore carries a
 * plain sentence first and the technical justification second.
 */

export type PriorFit = 'good' | 'fair' | 'weak' | 'rejected';

export interface PriorSource {
  id: PriorSourceId;
  title: string;
  /** What the user recognises themselves in. */
  summary: string;
  fit: PriorFit;
  fitLabel: string;
  /** Why the fit is what it is, in the user's terms. */
  rationale: string;
  /** Starting guess for how much of each mapped class is really that class. */
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
    title: 'Last season of this same map',
    summary: 'You ran this map before and know how well it did.',
    fit: 'good',
    fitLabel: 'Strong fit',
    rationale:
      'The same method over the same landscape usually makes the same kinds of mistakes, so last season’s accuracy is the best available guess for this season.',
    defaultCorrectShare: 0.85,
  },
  {
    id: 'published_map',
    title: 'A published map of the same area',
    summary: 'Someone else mapped this area and reported how accurate it was.',
    fit: 'fair',
    fitLabel: 'Reasonable fit',
    rationale:
      'The landscape is right but the method is not yours, so the accuracy figures transfer only roughly. Expect to be off by more than with your own map.',
    defaultCorrectShare: 0.75,
  },
  {
    id: 'expert_judgement',
    title: 'Expert judgement',
    summary: 'Analysts who know the map and the region estimate its accuracy.',
    fit: 'weak',
    fitLabel: 'Weak but usable',
    rationale:
      'Acceptable when the experts have actually looked at this map. It is a guess, so leave the safety floor in place and expect to adjust once points come in.',
    defaultCorrectShare: 0.7,
  },
  {
    id: 'held_out_test_set',
    title: 'A held-out test set from map training',
    summary: 'The points that were kept aside while the map was built.',
    fit: 'rejected',
    fitLabel: 'Cannot be used',
    rationale:
      'Test sets are almost never a random sample of the map: they sit where training data was easy to collect, so the accuracy they show is optimistic and does not describe the whole country. They also come from the map’s own development, so reusing them would let the map grade itself.',
    defaultCorrectShare: 0.8,
  },
  {
    id: 'none',
    title: 'Nothing reliable yet',
    summary: 'This is the first time this map is being checked.',
    fit: 'weak',
    fitLabel: 'Start with a pilot',
    rationale:
      'A small pilot sample measures the accuracy instead of guessing it. The pilot points are ordinary sample points and are kept, so nothing is wasted.',
    defaultCorrectShare: 0.7,
  },
];

export const priorSource = (id: PriorSourceId): PriorSource =>
  PRIOR_SOURCES.find((s) => s.id === id) ?? PRIOR_SOURCES[PRIOR_SOURCES.length - 1];

/** A prior source that cannot inform a design has to run a pilot instead. */
export const requiresPilot = (id: PriorSourceId): boolean =>
  id === 'none' || id === 'held_out_test_set';

export interface PrecisionPreset {
  cv: number;
  title: string;
  example: string;
}

/**
 * Target precision is stated as a coefficient of variation: the margin of
 * error as a percentage of the number itself. The examples anchor it to what
 * statistical agencies actually publish.
 */
export const PRECISION_PRESETS: PrecisionPreset[] = [
  {
    cv: 0.02,
    title: 'Official national statistics',
    example:
      'What USDA’s National Agricultural Statistics Service targets for maize, soybean and winter wheat area. Expensive: it needs thousands of points.',
  },
  {
    cv: 0.05,
    title: 'National reporting, main crops',
    example:
      'Good enough to publish a national planted area and to see a real year-on-year change. The usual choice for a ministry’s headline crop.',
  },
  {
    cv: 0.1,
    title: 'Programme monitoring',
    example:
      'Enough to track a trend, size a subsidy programme, or report a minor crop. A 1.0 Mha estimate would carry roughly ±0.2 Mha.',
  },
];

/**
 * Why every class gets a minimum number of points regardless of how small it
 * is on the map. Shown next to the floor control.
 */
export const SAMPLE_FLOOR_RATIONALE =
  'A class that covers little of the map gets almost no points under a plain proportional split, and a handful of points cannot say anything about it. Olofsson et al. (2014) recommend 50 to 100 points in each rare class. The floor only widens the confidence interval of the other classes if you take points away from them, which this tool does not do: it adds to the total instead.';

export const DEFAULT_SAMPLE_FLOOR = 75;
/** Points the pilot buys for each class before the floor is applied. */
export const DEFAULT_PILOT_BUDGET_PER_CLASS = 40;

/** No class drops below this in the pilot, however little of the map it covers. */
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
