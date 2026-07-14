export const TEST_USER_ID = 'test-user-abc-123';

export const MOCK_USER = {
  id: TEST_USER_ID,
  email: 'test@example.com',
  display_name: 'Test User',
  is_approved: true,
  is_admin: false,
  issuer: 'firebase',
};

// Labels for the campaign
export const LABELS = [
  { id: 1, name: 'forest', geometry_type: null },
  { id: 2, name: 'cropland', geometry_type: null },
  { id: 3, name: 'urban', geometry_type: null },
];

// Two slices with unique tile URLs (so we can verify the correct one loads)
const SLICE_2024_01 = {
  id: 101,
  name: 'Jan 2024',
  start_date: '2024-01-01',
  end_date: '2024-01-31',
  display_order: 0,
  tile_urls: [
    {
      visualization_name: 'True Color',
      tile_url:
        'https://tiles.example.com/mosaic/search-jan-2024/tiles/WebMercatorQuad/{z}/{x}/{y}?viz=truecolor',
    },
    {
      visualization_name: 'False Color',
      tile_url:
        'https://tiles.example.com/mosaic/search-jan-2024/tiles/WebMercatorQuad/{z}/{x}/{y}?viz=falsecolor',
    },
  ],
};

const SLICE_2024_06 = {
  id: 102,
  name: 'Jun 2024',
  start_date: '2024-06-01',
  end_date: '2024-06-30',
  display_order: 1,
  tile_urls: [
    {
      visualization_name: 'True Color',
      tile_url:
        'https://tiles.example.com/mosaic/search-jun-2024/tiles/WebMercatorQuad/{z}/{x}/{y}?viz=truecolor',
    },
    {
      visualization_name: 'False Color',
      tile_url:
        'https://tiles.example.com/mosaic/search-jun-2024/tiles/WebMercatorQuad/{z}/{x}/{y}?viz=falsecolor',
    },
  ],
};

const COLLECTION_S2 = {
  id: 10,
  name: 'Sentinel-2 L2A',
  cover_slice_index: 0,
  display_order: 0,
  slices: [SLICE_2024_01, SLICE_2024_06],
  stac_config: null,
};

// A second collection for multi-window testing
const COLLECTION_NDVI = {
  id: 20,
  name: 'NDVI',
  cover_slice_index: 0,
  display_order: 1,
  slices: [
    {
      id: 201,
      name: 'Jan 2024',
      start_date: '2024-01-01',
      end_date: '2024-01-31',
      display_order: 0,
      tile_urls: [
        {
          visualization_name: 'NDVI',
          tile_url:
            'https://tiles.example.com/mosaic/ndvi-jan-2024/tiles/WebMercatorQuad/{z}/{x}/{y}?viz=ndvi',
        },
      ],
    },
  ],
};

const SOURCE = {
  id: 1,
  name: 'Sentinel-2',
  crosshair_hex6: '#ff0000',
  default_zoom: 14,
  visualizations: [
    { id: 1, name: 'True Color' },
    { id: 2, name: 'False Color' },
  ],
  collections: [COLLECTION_S2, COLLECTION_NDVI],
};

const VIEW_DEFAULT = {
  id: 1,
  name: 'Default View',
  display_order: 0,
  collection_refs: [
    { collection_id: 10, source_id: 1, show_as_window: true, display_order: 0 },
    { collection_id: 20, source_id: 1, show_as_window: true, display_order: 1 },
  ],
  default_canvas_layout: null,
  personal_canvas_layout: null,
};

const DEFAULT_LAYOUT = {
  id: 1,
  user_id: null,
  layout_data: [
    { i: 'main', x: 0, y: 0, w: 44, h: 26 },
    { i: 'controls', x: 44, y: 0, w: 16, h: 26 },
    // timeseries card below main - must be present so Chart.js gets a real size
    { i: 'timeseries', x: 0, y: 26, w: 44, h: 14 },
  ],
};

// Full campaign object
export const MOCK_CAMPAIGN = {
  id: 42,
  name: 'Test Campaign',
  created_at: '2024-01-01T00:00:00Z',
  mode: 'tasks',
  settings: {
    labels: LABELS,
    bbox_west: 30.0,
    bbox_south: 50.0,
    bbox_east: 31.0,
    bbox_north: 51.0,
    embedding_year: null,
    // Mirrors DEFAULT_LABELLING_POLICY (LabellingPolicyEditor.tsx) / backend
    // default_labelling_policy(): AnnotationPage/AnnotationToolbar read
    // campaign.settings.labelling_policy.explore unconditionally.
    labelling_policy: {
      explore: { kinds: ['members'], user_ids: [] },
      unassigned_tasks: { kinds: ['members'], user_ids: [] },
      assigned_tasks: { kinds: ['members'], user_ids: [] },
      complete_assigned: { kinds: ['assignees', 'admins', 'authoritative'], user_ids: [] },
    },
  },
  imagery_sources: [SOURCE],
  imagery_views: [VIEW_DEFAULT],
  basemaps: [],
  time_series: [],
  default_main_canvas_layout: DEFAULT_LAYOUT,
  personal_main_canvas_layout: null,
};

// Helper to build a task with a specific point
function makeTask(
  id: number,
  annotationNumber: number,
  lat: number,
  lon: number,
  opts: {
    status?: string;
    annotations?: any[];
    assignments?: any[];
  } = {}
) {
  return {
    id,
    annotation_number: annotationNumber,
    task_status: opts.status ?? 'pending',
    geometry: {
      id: id * 10,
      geometry: `POINT(${lon} ${lat})`,
    },
    assignments: opts.assignments ?? [
      { user_id: TEST_USER_ID, status: 'pending', user_email: 'test@example.com', user_display_name: 'Test User' },
    ],
    annotations: opts.annotations ?? [],
  };
}

// Task 1: pending, no annotations
export const TASK_1 = makeTask(100, 1, 50.45, 30.52);

// Task 2: pending, no annotations (different location)
export const TASK_2 = makeTask(200, 2, 50.65, 30.75);

// Task 3: done, has an existing annotation from our user
export const TASK_3 = makeTask(300, 3, 50.30, 30.90, {
  status: 'done',
  annotations: [
    {
      id: 3001,
      label_id: 1,
      comment: 'Clearly forest',
      created_by_user_id: TEST_USER_ID,
      created_at: '2024-06-15T10:00:00Z',
      confidence: 8,
      is_authoritative: false,
      geometry: { id: 3010, geometry: 'POINT(30.90 50.30)' },
    },
  ],
  assignments: [{ user_id: TEST_USER_ID, status: 'done', user_email: 'test@example.com', user_display_name: 'Test User' }],
});

// Task 4: skipped
export const TASK_4 = makeTask(400, 4, 50.10, 30.40, {
  status: 'skipped',
  annotations: [],
  assignments: [{ user_id: TEST_USER_ID, status: 'skipped', user_email: 'test@example.com', user_display_name: 'Test User' }],
});

// Task 5: conflicting (two annotators, different labels). Also exercises:
//   - the current user's annotation is flagged_for_review with a flag_comment
//   - the other annotator's annotation is is_authoritative
// so the review-mode display can be asserted on a single task.
export const TASK_5 = makeTask(500, 5, 50.55, 30.60, {
  status: 'conflicting',
  annotations: [
    {
      id: 5001,
      label_id: 1,
      comment: null,
      created_by_user_id: TEST_USER_ID,
      created_at: '2024-06-16T10:00:00Z',
      confidence: 4,
      is_authoritative: false,
      flagged_for_review: true,
      flag_comment: 'Unsure about this one',
      geometry: { id: 5010, geometry: 'POINT(30.60 50.55)' },
    },
    {
      id: 5002,
      label_id: 2,
      comment: null,
      created_by_user_id: 'other-user-xyz',
      created_at: '2024-06-16T11:00:00Z',
      confidence: 5,
      is_authoritative: true,
      geometry: { id: 5020, geometry: 'POINT(30.60 50.55)' },
    },
  ],
  assignments: [
    { user_id: TEST_USER_ID, status: 'done', user_email: 'test@example.com', user_display_name: 'Test User' },
    { user_id: 'other-user-xyz', status: 'done', user_email: 'other@example.com', user_display_name: 'Other User' },
  ],
});

export const ALL_TASKS = [TASK_1, TASK_2, TASK_3, TASK_4, TASK_5];

/**
 * Expected map center (lat/lon) for each task, keyed by task id.
 * Derived from the POINT(lon lat) in each task's geometry.
 * Tests use this to verify the map/crosshair is centered on the correct task.
 */
export const TASK_LOCATIONS: Record<number, { lat: number; lon: number }> = {
  100: { lat: 50.45, lon: 30.52 },
  200: { lat: 50.65, lon: 30.75 },
  300: { lat: 50.30, lon: 30.90 },
  400: { lat: 50.10, lon: 30.40 },
  500: { lat: 50.55, lon: 30.60 },
};

export const MOCK_TASK_LIST = {
  campaign_id: 42,
  tasks: ALL_TASKS,
};

// Every migrated campaign starts with exactly one task set (default backfill
// set), so the task set picker stays hidden until a second set is created.
export const MOCK_TASK_SETS = [
  { id: 1, name: 'Default', created_at: '2024-01-01T00:00:00Z', num_tasks: ALL_TASKS.length, num_labeled: 0 },
];

export const MOCK_CAMPAIGN_USERS = {
  campaign_id: 42,
  users: [
    {
      user: { id: TEST_USER_ID, email: 'test@example.com', display_name: 'Test User', is_approved: true, is_admin: false, issuer: 'firebase' },
      is_admin: false,
      is_authorative_reviewer: false,
    },
    {
      user: { id: 'other-user-xyz', email: 'other@example.com', display_name: 'Other User', is_approved: true, is_admin: false, issuer: 'firebase' },
      is_admin: false,
      is_authorative_reviewer: false,
    },
  ],
};

/** Variant where the current user is an authoritative reviewer. */
export const MOCK_CAMPAIGN_USERS_AUTHORITATIVE = {
  campaign_id: 42,
  users: [
    {
      user: { id: TEST_USER_ID, email: 'test@example.com', display_name: 'Test User', is_approved: true, is_admin: false, issuer: 'firebase' },
      is_admin: false,
      is_authorative_reviewer: true,
    },
    {
      user: { id: 'other-user-xyz', email: 'other@example.com', display_name: 'Other User', is_approved: true, is_admin: false, issuer: 'firebase' },
      is_admin: false,
      is_authorative_reviewer: false,
    },
  ],
};

/** Standard submit response after annotating a task */
export function makeSubmitResponse(
  taskId: number,
  labelId: number | null,
  comment: string | null,
  confidence: number
) {
  return {
    annotation: labelId !== null
      ? {
          id: taskId * 10 + 1,
          label_id: labelId,
          comment,
          created_by_user_id: TEST_USER_ID,
          created_at: new Date().toISOString(),
          confidence,
          is_authoritative: false,
          geometry: { id: taskId * 10 + 2, geometry: 'POINT(0 0)' },
        }
      : null,
    task_status: labelId !== null ? 'done' : 'pending',
    assignment_status: labelId !== null ? 'done' : 'skipped',
  };
}

// Delete annotation response
export function makeDeleteResponse() {
  return { task_status: 'pending', assignment_status: 'pending' };
}

// ---------------------------------------------------------------------------
// Multi-source campaign fixtures
// ---------------------------------------------------------------------------

export const COLLECTION_VHR = {
  id: 30,
  name: 'VHR Image',
  cover_slice_index: 0,
  display_order: 0,
  stac_config: null,
  slices: [
    {
      id: 301,
      name: 'VHR 2023',
      start_date: '2023-01-01',
      end_date: '2023-12-31',
      display_order: 0,
      tile_urls: [
        {
          visualization_name: 'True Color',
          tile_url:
            'https://tiles.example.com/mosaic/vhr-2023/tiles/WebMercatorQuad/{z}/{x}/{y}?viz=vhr-truecolor',
        },
      ],
    },
  ],
};

export const SOURCE_VHR = {
  id: 2,
  name: 'VHR',
  crosshair_hex6: '#0000ff',
  default_zoom: 16,
  visualizations: [{ id: 3, name: 'True Color' }],
  collections: [COLLECTION_VHR],
};

/**
 * Campaign with two imagery sources: Sentinel-2 (True Color + False Color) and VHR
 * (True Color only). The view references one collection from each source so the I key
 * can cycle between them.
 */
export const MOCK_CAMPAIGN_MULTI_SOURCE = {
  ...MOCK_CAMPAIGN,
  imagery_sources: [SOURCE, SOURCE_VHR],
  imagery_views: [
    {
      id: 1,
      name: 'Default View',
      display_order: 0,
      collection_refs: [
        { collection_id: 10, source_id: 1, show_as_window: true, display_order: 0 },
        { collection_id: 30, source_id: 2, show_as_window: true, display_order: 1 },
      ],
      default_canvas_layout: null,
      personal_canvas_layout: null,
    },
  ],
};

// ---------------------------------------------------------------------------
// Timeseries fixtures
// ---------------------------------------------------------------------------

export const MOCK_TIMESERIES_ENTRY = {
  id: 1,
  campaign_id: 42,
  name: 'NDVI',
  start_ym: '202401',
  end_ym: '202406',
  data_source: 'Sentinel-2',
  provider: 'planetary',
  ts_type: 'ndvi',
};

// Bi-weekly NDVI observations over a growing season with some cloud-flagged entries.
// Format: { time: YYYYMMDD, values: ndvi (0-1), cloud: 0=clear 1=cloudy }
export const MOCK_TIMESERIES_DATA = [
  { time: '20240101', values: 0.12, cloud: 0 },
  { time: '20240115', values: 0.14, cloud: 0 },
  { time: '20240129', values: 0.11, cloud: 1 }, // cloudy
  { time: '20240212', values: 0.17, cloud: 0 },
  { time: '20240226', values: 0.22, cloud: 0 },
  { time: '20240311', values: 0.28, cloud: 0 },
  { time: '20240325', values: 0.35, cloud: 1 }, // cloudy
  { time: '20240408', values: 0.45, cloud: 0 },
  { time: '20240422', values: 0.55, cloud: 0 },
  { time: '20240506', values: 0.63, cloud: 0 },
  { time: '20240520', values: 0.68, cloud: 0 },
  { time: '20240603', values: 0.71, cloud: 0 },
  { time: '20240617', values: 0.73, cloud: 1 }, // cloudy
  { time: '20240701', values: 0.72, cloud: 0 },
  { time: '20240715', values: 0.70, cloud: 0 },
  { time: '20240729', values: 0.66, cloud: 0 },
  { time: '20240812', values: 0.60, cloud: 0 },
  { time: '20240826', values: 0.53, cloud: 0 },
  { time: '20240909', values: 0.45, cloud: 1 }, // cloudy
  { time: '20240923', values: 0.37, cloud: 0 },
];

export const MOCK_CAMPAIGN_WITH_TIMESERIES = {
  ...MOCK_CAMPAIGN,
  time_series: [MOCK_TIMESERIES_ENTRY],
};

// ---------------------------------------------------------------------------
// Multi-collection source fixture (mirrors real-world imagery shape).
//
// One source whose collections each cover a single month; every collection
// holds a month-spanning "Cover" slice plus weekly slices. The timeseries
// spans the whole year, so a click on the chart usually resolves to a slice
// in a SIBLING collection - exercising collection-switching on chart click,
// which the single-collection fixtures above cannot.
// ---------------------------------------------------------------------------

const monthSlices = (collId: number, marker: string, ym: string, lastDay: string) => [
  {
    id: collId * 100 + 0,
    name: 'Cover',
    start_date: `${ym}-01`,
    end_date: `${ym}-${lastDay}`,
    display_order: 0,
    tile_urls: [
      {
        visualization_name: 'True Color',
        tile_url: `https://tiles.example.com/mosaic/${marker}-cover/tiles/WebMercatorQuad/{z}/{x}/{y}`,
      },
    ],
  },
  ...[
    ['Wk1', '01', '07'],
    ['Wk2', '08', '14'],
    ['Wk3', '15', '21'],
    ['Wk4', '22', lastDay],
  ].map(([wk, s, e], idx) => ({
    id: collId * 100 + idx + 1,
    name: wk,
    start_date: `${ym}-${s}`,
    end_date: `${ym}-${e}`,
    display_order: idx + 1,
    tile_urls: [
      {
        visualization_name: 'True Color',
        tile_url: `https://tiles.example.com/mosaic/${marker}-${wk.toLowerCase()}/tiles/WebMercatorQuad/{z}/{x}/{y}`,
      },
    ],
  })),
];

export const COLLECTION_MAR_2022 = {
  id: 7001,
  name: 'Mar 2022',
  cover_slice_index: 0,
  has_dedicated_cover: true,
  display_order: 0,
  slices: monthSlices(7001, 'mar2022', '2022-03', '31'),
  stac_config: null,
};

export const COLLECTION_SEP_2022 = {
  id: 7002,
  name: 'Sep 2022',
  cover_slice_index: 0,
  has_dedicated_cover: true,
  display_order: 1,
  slices: monthSlices(7002, 'sep2022', '2022-09', '30'),
  stac_config: null,
};

const SOURCE_MONTHS = {
  id: 700,
  name: 'Imagery',
  crosshair_hex6: '#00aa55',
  default_zoom: 14,
  visualizations: [{ id: 1, name: 'True Color' }],
  collections: [COLLECTION_MAR_2022, COLLECTION_SEP_2022],
};

// One NDVI observation on the 15th of each month, Jan -> Sep 2022. Two things
// matter for the tests: the series ends in Sep (so a far-right click resolves
// to the Sep collection), and every point sits mid-month - exactly on a
// dedicated cover's date-range midpoint - so a naive nearest-midpoint search
// would pick the cover. The handler must skip it and choose a weekly slice.
export const MONTHS_TIMESERIES_DATA = Array.from({ length: 9 }, (_, i) => {
  const month = String(i + 1).padStart(2, '0');
  return { time: `2022-${month}-15`, values: 0.3 + (i % 5) * 0.1, cloud: 0 };
});

export const MONTHS_TIMESERIES_ENTRY = {
  id: 70,
  campaign_id: 42,
  name: 'NDVI',
  start_ym: '202201',
  end_ym: '202212',
  data_source: 'Imagery',
  provider: 'planetary',
  ts_type: 'ndvi',
};

export const MOCK_CAMPAIGN_MONTHS = {
  ...MOCK_CAMPAIGN,
  imagery_sources: [SOURCE_MONTHS],
  imagery_views: [
    {
      id: 1,
      name: 'Months View',
      display_order: 0,
      collection_refs: [
        { collection_id: 7001, source_id: 700, show_as_window: true, display_order: 0 },
        { collection_id: 7002, source_id: 700, show_as_window: true, display_order: 1 },
      ],
      default_canvas_layout: null,
      personal_canvas_layout: null,
    },
  ],
  time_series: [MONTHS_TIMESERIES_ENTRY],
};

// ---------------------------------------------------------------------------
// Multi-view campaign fixtures
// ---------------------------------------------------------------------------

export const MOCK_CAMPAIGN_MULTI_VIEW = {
  ...MOCK_CAMPAIGN,
  imagery_sources: [SOURCE, SOURCE_VHR],
  imagery_views: [
    {
      id: 1,
      name: 'Sentinel-2 View',
      display_order: 0,
      collection_refs: [
        { collection_id: 10, source_id: 1, show_as_window: true, display_order: 0 },
        { collection_id: 20, source_id: 1, show_as_window: true, display_order: 1 },
      ],
      default_canvas_layout: null,
      personal_canvas_layout: null,
    },
    {
      id: 2,
      name: 'VHR View',
      display_order: 1,
      collection_refs: [
        { collection_id: 30, source_id: 2, show_as_window: true, display_order: 0 },
      ],
      default_canvas_layout: null,
      personal_canvas_layout: null,
    },
  ],
};

// ---------------------------------------------------------------------------
// Open mode campaign fixtures
// ---------------------------------------------------------------------------

// Open-mode labels carry an explicit geometry_type so the drawing tool picks the
// right OL interaction (point = single-click, polygon/line = multi-click).
export const OPEN_LABELS = [
  { id: 1, name: 'tree', geometry_type: 'point' },
  { id: 2, name: 'field', geometry_type: 'polygon' },
  { id: 3, name: 'road', geometry_type: 'line' },
];

// Center of the campaign bbox (30..31 lon, 50..51 lat) - the initial map center
// in open mode. A canvas-center click lands here, so position assertions compare
// the POSTed WKT against this.
export const OPEN_MODE_CENTER = { lat: 50.5, lon: 30.5 };

export const MOCK_CAMPAIGN_OPEN_MODE = {
  ...MOCK_CAMPAIGN,
  name: 'Test Campaign (Open Mode)',
  mode: 'open',
  settings: { ...MOCK_CAMPAIGN.settings, labels: OPEN_LABELS },
  time_series: [MOCK_TIMESERIES_ENTRY],
};

/** Same campaign without timeseries, so the T tool is unavailable. */
export const MOCK_CAMPAIGN_OPEN_MODE_NO_TS = {
  ...MOCK_CAMPAIGN_OPEN_MODE,
  time_series: [],
};

/**
 * Open-mode campaign with two imagery sources (Sentinel-2 + VHR) so the I key
 * can cycle sources, plus timeseries for the probe tool.
 */
export const MOCK_CAMPAIGN_OPEN_MODE_MULTI = {
  ...MOCK_CAMPAIGN_MULTI_SOURCE,
  mode: 'open',
  settings: { ...MOCK_CAMPAIGN.settings, labels: OPEN_LABELS },
  time_series: [MOCK_TIMESERIES_ENTRY],
  // Layout that gives the minimap a real on-screen size so it is clickable.
  default_main_canvas_layout: {
    id: 2,
    user_id: null,
    layout_data: [
      { i: 'main', x: 0, y: 0, w: 38, h: 24 },
      { i: 'controls', x: 38, y: 0, w: 22, h: 12 },
      { i: 'minimap', x: 38, y: 12, w: 22, h: 12 },
      { i: 'timeseries', x: 0, y: 24, w: 38, h: 14 },
    ],
  },
};

function makeOpenAnnotation(
  id: number,
  labelId: number,
  wkt: string,
  updatedAt: string,
  opts: { flagged?: boolean; flagComment?: string | null; comment?: string | null } = {}
) {
  return {
    id,
    label_id: labelId,
    comment: opts.comment ?? null,
    created_by_user_id: TEST_USER_ID,
    created_by_user_email: 'test@example.com',
    created_by_user_display_name: 'Test User',
    created_at: updatedAt,
    updated_at: updatedAt,
    confidence: null,
    is_authoritative: false,
    flagged_for_review: opts.flagged ?? false,
    flag_comment: opts.flagged ? (opts.flagComment ?? null) : null,
    geometry: { id: id * 10, geometry: wkt },
  };
}

// Three pre-existing annotations. Sorted newest-first the order is [B, A, C]:
//   B (newest) is off-centre (NE) - pressing S navigates here and re-centres the map.
//   A is exactly at the view centre - a canvas-centre click selects it (edit/delete/flag).
//   C (oldest) is a polygon to the SW.
export const OPEN_ANN_CENTER = makeOpenAnnotation(9001, 1, 'POINT(30.5 50.5)', '2024-06-10T10:00:00Z');
export const OPEN_ANN_NE_FLAGGED = makeOpenAnnotation(
  9002,
  1,
  'POINT(30.8 50.8)',
  '2024-06-20T10:00:00Z',
  { flagged: true, flagComment: 'please double-check' }
);
export const OPEN_ANN_SW_POLYGON = makeOpenAnnotation(
  9003,
  2,
  'POLYGON((30.18 50.18, 30.22 50.18, 30.22 50.22, 30.18 50.22, 30.18 50.18))',
  '2024-06-01T10:00:00Z'
);

export const MOCK_OPEN_ANNOTATIONS = [OPEN_ANN_CENTER, OPEN_ANN_NE_FLAGGED, OPEN_ANN_SW_POLYGON];

/** Build an AnnotationOut echoing back a create-annotation POST body. */
export function makeCreateAnnotationResponse(body: any, id: number) {
  return {
    id,
    label_id: body?.label_id ?? null,
    comment: body?.comment ?? null,
    created_by_user_id: TEST_USER_ID,
    created_by_user_email: 'test@example.com',
    created_by_user_display_name: 'Test User',
    created_at: '2024-07-01T10:00:00Z',
    updated_at: '2024-07-01T10:00:00Z',
    confidence: body?.confidence ?? null,
    is_authoritative: false,
    flagged_for_review: body?.flagged_for_review ?? false,
    flag_comment: body?.flag_comment ?? null,
    geometry: { id: id * 10, geometry: body?.geometry_wkt ?? 'POINT(0 0)' },
  };
}

/** Merge an annotation-update PUT body onto the existing annotation. */
export function makeUpdateAnnotationResponse(existing: any, body: any) {
  return {
    ...existing,
    label_id: body?.label_id ?? existing.label_id,
    comment: body?.comment ?? existing.comment,
    flagged_for_review:
      body?.flagged_for_review ?? existing.flagged_for_review,
    flag_comment:
      body?.flagged_for_review === false ? null : (body?.flag_comment ?? existing.flag_comment),
    updated_at: '2024-07-02T10:00:00Z',
    geometry: body?.geometry_wkt
      ? { ...existing.geometry, geometry: body.geometry_wkt }
      : existing.geometry,
  };
}

// Re-export individual slices / collections for direct assertions in tests
export { SLICE_2024_01, SLICE_2024_06, COLLECTION_S2, COLLECTION_NDVI, SOURCE };
