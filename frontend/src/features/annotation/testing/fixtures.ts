import type {
  AnnotationFromTaskOut,
  AnnotationOut,
  AnnotationTaskListOut,
  AnnotationTaskOut,
  CampaignOutFull,
  ClaimTaskResponse,
  CustomMapOut,
  ImageryCollectionOut,
  ImagerySliceOut,
  ImagerySourceOut,
  ImageryViewOut,
  SliceTileUrlOut,
  TaskSetOut,
  TimeSeriesOut,
  VectorLayerOut,
  VisualizationTemplateOut,
} from '~/api/client';

/**
 * Minimal valid fixtures for catalog, store and panel tests. Individual tests
 * override only the fields their scenario cares about.
 * Not a `*.test.ts` file so vitest never collects it as a spec.
 */
export function makeCampaign(overrides: Partial<CampaignOutFull> = {}): CampaignOutFull {
  return {
    id: 7,
    project_id: 1,
    name: 'Test campaign',
    created_at: '2024-01-01T00:00:00Z',
    mode: 'open',
    is_public: true,
    imagery_sources: [],
    imagery_views: [],
    basemaps: [],
    time_series: [],
    default_main_canvas_layout: null,
    personal_main_canvas_layout: null,
    settings: {
      bbox_west: -10,
      bbox_south: -20,
      bbox_east: 10,
      bbox_north: 20,
      labelling_policy: {
        explore: { kinds: ['anyone'] },
        assigned_tasks: { kinds: ['anyone'] },
        complete_assigned: { kinds: ['anyone'] },
        unassigned_tasks: { kinds: ['anyone'] },
      },
      labels: [],
    },
    ...overrides,
  };
}

export function makeViz(
  overrides: Partial<VisualizationTemplateOut> = {}
): VisualizationTemplateOut {
  return { id: 1, name: 'True Color', display_order: 0, ...overrides };
}

export function makeTileUrl(overrides: Partial<SliceTileUrlOut> = {}): SliceTileUrlOut {
  return {
    id: 1,
    visualization_name: 'True Color',
    tile_url: 'https://tiles/{z}/{x}/{y}',
    ...overrides,
  };
}

export function makeSlice(overrides: Partial<ImagerySliceOut> = {}): ImagerySliceOut {
  return {
    id: 1,
    name: 's0',
    start_date: '2024-01-01',
    end_date: '2024-01-31',
    display_order: 0,
    tile_urls: [],
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
    status_error: null,
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
  return { ...annotationDefaults, geometry: { id: 1, geometry: 'POINT (1 2)' }, ...overrides };
}

export function makeTaskAnnotation(
  overrides: Partial<AnnotationFromTaskOut> = {}
): AnnotationFromTaskOut {
  return { ...annotationDefaults, ...overrides };
}

export function makeTask(overrides: Partial<AnnotationTaskOut> = {}): AnnotationTaskOut {
  return {
    id: 1,
    annotation_number: 1,
    task_set_id: 1,
    task_status: 'pending',
    geometry: { id: 1, geometry: 'POINT (1 2)' },
    assignments: [],
    annotations: [],
    ...overrides,
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
  return { task_id: 1, claimed_at: '2024-01-01T00:00:00Z', ...overrides };
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

export function makeTimeSeries(overrides: Partial<TimeSeriesOut> = {}): TimeSeriesOut {
  return {
    id: 1,
    campaign_id: 7,
    name: 'TS1',
    start_ym: '2024-01',
    end_ym: '2024-12',
    data_source: 'sentinel2',
    provider: 'gee',
    ts_type: 'ndvi',
    ...overrides,
  };
}

export function makeTaskList(
  overrides: Partial<AnnotationTaskListOut> = {}
): AnnotationTaskListOut {
  return { campaign_id: 7, tasks: [], ...overrides };
}

/**
 * The real generated client returns `{ data, error, request, response }`
 * (or the throw-on-error `{ data, request, response }` shape) from every SDK
 * call. Tests mock `vi.mocked(sdkFn).mockResolvedValue(...)` and only care
 * about `data`, so this fills in a real `Request`/`Response` for the rest.
 */
export function apiSuccess<T>(data: T): {
  data: T;
  error: undefined;
  request: Request;
  response: Response;
} {
  return {
    data,
    error: undefined,
    request: new Request('http://test.local/'),
    response: new Response(),
  };
}
