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
    { i: 'main', x: 0, y: 0, w: 6, h: 4 },
    { i: 'controls', x: 0, y: 4, w: 6, h: 2 },
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

// Task 5: conflicting (two annotators, different labels)
export const TASK_5 = makeTask(500, 5, 50.55, 30.60, {
  status: 'conflicting',
  annotations: [
    {
      id: 5001,
      label_id: 1,
      comment: null,
      created_by_user_id: TEST_USER_ID,
      created_at: '2024-06-16T10:00:00Z',
      confidence: 7,
      is_authoritative: false,
      geometry: { id: 5010, geometry: 'POINT(30.60 50.55)' },
    },
    {
      id: 5002,
      label_id: 2,
      comment: null,
      created_by_user_id: 'other-user-xyz',
      created_at: '2024-06-16T11:00:00Z',
      confidence: 6,
      is_authoritative: false,
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

// Re-export individual slices / collections for direct assertions in tests
export { SLICE_2024_01, SLICE_2024_06, COLLECTION_S2, COLLECTION_NDVI, SOURCE };
