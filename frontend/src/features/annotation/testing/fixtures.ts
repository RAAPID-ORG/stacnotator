export { apiSuccess } from '~/shared/testing/apiSuccess';

import type { TaskRow, TaskRowAnswer, TaskRowAssignment } from '~/shared/utils/taskSummary';

import type {
  AnnotationFromTaskOut,
  AnnotationOut,
  TaskListOut,
  TaskOut,
  CampaignOutFull,
  ClaimTaskResponse,
  CustomMapOut,
  ImageryCollectionOut,
  ImagerySliceOut,
  ImageryGenerationSeriesOut,
  ImagerySourceOut,
  ImageryViewOut,
  PlanetScenesGenerationConfig,
  SliceTileOut,
  TaskSetOut,
  TaskSummaryOut,
  TimeseriesOut,
  VectorLayerOut,
  VisualizationOut,
} from '~/api/client';

/**
 * Minimal valid fixtures for catalog, store and panel tests. Individual tests
 * override only the fields their scenario cares about.
 * Not a `*.test.ts` file so vitest never collects it as a spec.
 */
export function makeSettings(
  overrides: Partial<CampaignOutFull['settings']> = {}
): CampaignOutFull['settings'] {
  return {
    bbox_west: -10,
    bbox_south: -20,
    bbox_east: 10,
    bbox_north: 20,
    labelling_policy: {
      explore: { kinds: ['anyone'] },
      assigned_tasks: { kinds: ['anyone'] },
      complete_assigned: { kinds: ['anyone'] },
      modify_others: { kinds: ['admins'] },
      unassigned_tasks: { kinds: ['anyone'] },
    },
    labels: [],
    form_fields: [],
    research_sharing: false,
    task_output: 'classify',
    embedding_year: null,
    guide_markdown: null,
    sample_extent_meters: null,
    ...overrides,
  };
}

export function makeCampaign(overrides: Partial<CampaignOutFull> = {}): CampaignOutFull {
  return {
    id: 7,
    project_id: 1,
    name: 'Test campaign',
    created_at: '2024-01-01T00:00:00Z',
    is_public: true,
    imagery_sources: [],
    imagery_views: [],
    basemaps: [],
    time_series: [],
    default_main_canvas_layout: null,
    personal_main_canvas_layout: null,
    settings: makeSettings(),
    ...overrides,
  };
}

export function makeViz(overrides: Partial<VisualizationOut> = {}): VisualizationOut {
  return { id: 1, name: 'True Color', display_order: 0, ...overrides };
}

export function makeTile(overrides: Partial<SliceTileOut> = {}): SliceTileOut {
  return { visualization_id: 1, url: 'https://tiles/{z}/{x}/{y}', ...overrides };
}

export function makeSlice(overrides: Partial<ImagerySliceOut> = {}): ImagerySliceOut {
  return {
    id: 1,
    name: 's0',
    start_date: '2024-01-01',
    end_date: '2024-01-31',
    display_order: 0,
    // Resolved by default: a slice with no tiles is one nothing can draw, which
    // navigation skips. Pass `tiles: []` to build that case on purpose.
    tiles: [makeTile()],
    ...overrides,
  };
}

export function makeCollection(
  overrides: Partial<ImageryCollectionOut> = {}
): ImageryCollectionOut {
  return { id: 1, name: 'C1', cover_slice_index: 0, display_order: 0, slices: [], ...overrides };
}

export function makeSource(overrides: Partial<ImagerySourceOut> = {}): ImagerySourceOut {
  return {
    id: 1,
    name: 'S1',
    crosshair_hex6: 'ff0000',
    default_zoom: 14,
    display_order: 0,
    visualizations: [],
    collections: [],
    ...overrides,
  };
}

/** A Planet scene series - the mark that makes a source one whose imagery is searched
 *  for at annotation time rather than registered up front. */
export function makeSceneSeries(
  overrides: Partial<PlanetScenesGenerationConfig> = {}
): ImageryGenerationSeriesOut {
  return {
    id: 1,
    config: {
      kind: 'planet_scenes',
      start_date: '2024-01-01',
      end_date: '2024-03-01',
      collection_period_interval: 1,
      collection_period_unit: 'months',
      slice_period_interval: 3,
      slice_period_unit: 'days',
      whole_window_cover: true,
      ...overrides,
    },
  };
}

export function makeView(overrides: Partial<ImageryViewOut> = {}): ImageryViewOut {
  return {
    id: 1,
    name: 'V1',
    display_order: 0,
    source_ids: [],
    default_canvas_layout: null,
    personal_canvas_layout: null,
    ...overrides,
  };
}

export function makeCustomMap(overrides: Partial<CustomMapOut> = {}): CustomMapOut {
  return {
    id: 1,
    campaign_id: 7,
    name: 'CM1',
    cog_url: 'https://cog/a.tif',
    render_config: { mode: 'continuous', colormap_name: 'viridis', rescale: [0, 1] },
    max_native_zoom: null,
    status: 'ready',
    status_errors: null,
    tile_url: 'https://tiles/cm/{z}/{x}/{y}',
    mosaic_id: null,
    display_order: 0,
    mlops_url: null,
    internal_storage: false,
    ...overrides,
  };
}

const annotationDefaults = {
  id: 1,
  label_id: 1,
  comment: null,
  created_by_user_id: 'u1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  confidence: null,
  is_authoritative: false,
  flagged_for_review: false,
  flag_comment: null,
  form_values: null,
} satisfies AnnotationFromTaskOut;

export function makeAnnotation(overrides: Partial<AnnotationOut> = {}): AnnotationOut {
  return { ...annotationDefaults, geometry_wkt: 'POINT (1 2)', ...overrides };
}

export function makeTaskAnnotation(
  overrides: Partial<AnnotationFromTaskOut> = {}
): AnnotationFromTaskOut {
  return { ...annotationDefaults, ...overrides };
}

export function makeTask(overrides: Partial<TaskOut> = {}): TaskOut {
  return {
    id: 1,
    annotation_number: 1,
    task_set_id: 1,
    task_status: 'pending',
    geometry_wkt: 'POINT (1 2)',
    assignments: [],
    annotations: [],
    ...overrides,
  };
}

export function makeTaskRowAnswer(overrides: Partial<TaskRowAnswer> = {}): TaskRowAnswer {
  return {
    id: 1,
    created_by_user_id: 'u1',
    created_by_user_display_name: 'u1',
    created_by_user_email: null,
    label_id: 1,
    outcome: 'labelled',
    confidence: null,
    flagged_for_review: false,
    active_seconds: null,
    is_authoritative: false,
    counts_toward_completion: true,
    comment: null,
    flag_comment: null,
    updated_at: '2024-01-01T00:00:00Z',
    answered_field_ids: [],
    ...overrides,
  };
}

export type TaskRowOverrides = Partial<Omit<TaskRow, 'assignments' | 'annotations'>> & {
  assignments?: (Pick<TaskRowAssignment, 'user_id' | 'status'> & Partial<TaskRowAssignment>)[];
  annotations?: Partial<TaskRowAnswer>[];
};

export function makeTaskRow({
  assignments = [],
  annotations = [],
  ...overrides
}: TaskRowOverrides = {}): TaskRow {
  return {
    id: 1,
    annotation_number: 1,
    task_set_id: 1,
    task_status: 'pending',
    claimed_by_user_id: null,
    claimed_at: null,
    claimed_by_display_name: null,
    lon: 1,
    lat: 2,
    nearby_annotation_count: 0,
    drawn_by_user_ids: [],
    assignments: assignments.map((a) => ({
      user_display_name: a.user_id,
      user_email: null,
      ...a,
    })),
    annotations: annotations.map((a) => makeTaskRowAnswer(a)),
    ...overrides,
  };
}

/** The columnar summary `decodeTaskSummary` turns back into `rows`. */
export function makeTaskSummary(
  rows: TaskRow[],
  serverTime = '2024-01-01T00:00:00Z'
): TaskSummaryOut {
  const users: TaskSummaryOut['users'] = { id: [], display_name: [], email: [] };
  const userIndex = (id: string, name = id, email: string | null = null) => {
    const known = users.id.indexOf(id);
    if (known >= 0) return known;
    users.id.push(id);
    users.display_name.push(name);
    users.email.push(email);
    return users.id.length - 1;
  };
  const assignments = rows.flatMap((row, task) =>
    row.assignments.map((a) => ({
      task,
      user: userIndex(a.user_id, a.user_display_name, a.user_email),
      status: a.status,
    }))
  );
  const answers = rows.flatMap((row, task) =>
    row.annotations.map((a) => ({
      ...a,
      task,
      user: userIndex(a.created_by_user_id, a.created_by_user_display_name),
    }))
  );
  const claimers = rows.map((row) =>
    row.claimed_by_user_id === null
      ? null
      : userIndex(row.claimed_by_user_id, row.claimed_by_display_name ?? undefined)
  );
  return {
    campaign_id: 1,
    server_time: serverTime,
    users,
    tasks: {
      id: rows.map((r) => r.id),
      annotation_number: rows.map((r) => r.annotation_number),
      task_set_id: rows.map((r) => r.task_set_id),
      task_status: rows.map((r) => r.task_status),
      claimed_by: claimers,
      claimed_at: rows.map((r) => r.claimed_at),
      lon: rows.map((r) => r.lon),
      lat: rows.map((r) => r.lat),
      nearby_annotation_count: rows.map((r) => r.nearby_annotation_count),
      drawn_by: rows.map((r) => r.drawn_by_user_ids.map((id) => userIndex(id))),
    },
    assignments: {
      task: assignments.map((a) => a.task),
      user: assignments.map((a) => a.user),
      status: assignments.map((a) => a.status),
    },
    answers: {
      id: answers.map((a) => a.id),
      task: answers.map((a) => a.task),
      user: answers.map((a) => a.user),
      label_id: answers.map((a) => a.label_id),
      outcome: answers.map((a) => a.outcome),
      confidence: answers.map((a) => a.confidence),
      flagged_for_review: answers.map((a) => a.flagged_for_review),
      active_seconds: answers.map((a) => a.active_seconds),
      is_authoritative: answers.map((a) => a.is_authoritative),
      counts_toward_completion: answers.map((a) => a.counts_toward_completion),
      comment: answers.map((a) => a.comment),
      flag_comment: answers.map((a) => a.flag_comment),
      updated_at: answers.map((a) => a.updated_at),
      answered_field_ids: answers.map((a) => a.answered_field_ids),
    },
  };
}

export function makeVectorLayer(overrides: Partial<VectorLayerOut> = {}): VectorLayerOut {
  return {
    id: 1,
    campaign_id: 7,
    name: 'VL1',
    pmtiles_url: 'https://storage/a.pmtiles',
    source_layer: null,
    color: '#ff0000',
    display_order: 0,
    ...overrides,
  };
}

export function makeClaimTaskResponse(
  overrides: Partial<ClaimTaskResponse> = {}
): ClaimTaskResponse {
  return { task_id: 1, claimed: true, claimed_at: '2024-01-01T00:00:00Z', ...overrides };
}

export function makeTaskSet(overrides: Partial<TaskSetOut> = {}): TaskSetOut {
  return {
    id: 1,
    name: 'Set 1',
    created_at: '2024-01-01T00:00:00Z',
    num_tasks: 0,
    num_labeled: 0,
    ...overrides,
  };
}

export function makeTimeSeries(overrides: Partial<TimeseriesOut> = {}): TimeseriesOut {
  return {
    id: 1,
    campaign_id: 7,
    name: 'TS1',
    window_id: 1,
    window_name: 'Time series',
    start_ym: '2024-01',
    end_ym: '2024-12',
    data_source: 'SENTINEL2',
    ts_type: 'NDVI',
    index: {
      key: 'NDVI',
      label: 'NDVI',
      formula: '(NIR - Red) / (NIR + Red)',
      domain_min: -0.2,
      domain_max: 1.0,
      reference_lines: [0.25, 0.75],
    },
    ...overrides,
  };
}

export function makeTaskList(overrides: Partial<TaskListOut> = {}): TaskListOut {
  return { campaign_id: 7, tasks: [], ...overrides };
}
