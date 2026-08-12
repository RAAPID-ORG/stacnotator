import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '~/api/client';
import type { FormField } from '~/features/annotation/core/apiTypes';
import { apiSuccess, makeAnnotation } from '~/features/annotation/core/catalog/testHelpers';
import type { BoxHit } from '~/features/annotation/engine/map';
import { annotationBody, labelFeature, labelFeaturesInBox } from './vectorLabel';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return {
    ...actual,
    createAnnotationOpenmode: vi.fn(),
    batchCreateAnnotations: vi.fn(),
  };
});

const POINT: GeoJSON.Geometry = { type: 'Point', coordinates: [1, 2] };
const SQUARE: GeoJSON.Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};

const REQUIRED_FIELDS: FormField[] = [
  { id: 3, title: 'Crop', type: 'category', required: true, options: [{ id: 30, name: 'wheat' }] },
];

function hit(layerId: string, id: string | number | undefined, geometry: GeoJSON.Geometry): BoxHit {
  return { layerId, feature: { id, geometry } };
}

beforeEach(() => {
  vi.mocked(api.createAnnotationOpenmode).mockReset();
  vi.mocked(api.batchCreateAnnotations).mockReset();
});

describe('annotationBody', () => {
  it('carries the label, the geometry as WKT and no answers when there are none', () => {
    expect(annotationBody(POINT, 7, {})).toEqual({
      label_id: 7,
      comment: null,
      geometry_wkt: 'POINT (1 2)',
      confidence: null,
      form_values: null,
    });
  });

  it('keeps the answers when the form has some', () => {
    expect(annotationBody(POINT, 7, { '3': 30 }).form_values).toEqual({ '3': 30 });
  });
});

describe('labelFeature', () => {
  it('creates one annotation from the clicked feature geometry', async () => {
    vi.mocked(api.createAnnotationOpenmode).mockResolvedValue(apiSuccess(makeAnnotation()));

    const outcome = await labelFeature({
      campaignId: 5,
      geometry: SQUARE,
      labelId: 7,
      fields: [],
      formValues: {},
    });

    expect(outcome).toEqual({ kind: 'saved', count: 1 });
    expect(api.createAnnotationOpenmode).toHaveBeenCalledWith({
      path: { campaign_id: 5 },
      body: annotationBody(SQUARE, 7, {}),
    });
  });

  it('blocks on unanswered required fields instead of saving', async () => {
    const outcome = await labelFeature({
      campaignId: 5,
      geometry: SQUARE,
      labelId: 7,
      fields: REQUIRED_FIELDS,
      formValues: {},
    });

    expect(outcome).toEqual({ kind: 'blocked', missing: ['Crop'] });
    expect(api.createAnnotationOpenmode).not.toHaveBeenCalled();
  });

  it('reports the failure rather than throwing', async () => {
    vi.mocked(api.createAnnotationOpenmode).mockRejectedValue(new Error('boom'));

    const outcome = await labelFeature({
      campaignId: 5,
      geometry: SQUARE,
      labelId: 7,
      fields: [],
      formValues: {},
    });

    expect(outcome).toEqual({ kind: 'error', message: 'boom' });
  });
});

describe('labelFeaturesInBox', () => {
  it('sends every boxed feature as one batch and reports what was created', async () => {
    vi.mocked(api.batchCreateAnnotations).mockResolvedValue(apiSuccess({ created_count: 2 }));

    const outcome = await labelFeaturesInBox({
      campaignId: 5,
      hits: [hit('vector-1', 11, SQUARE), hit('vector-1', 12, POINT)],
      labelId: 7,
      fields: [],
      formValues: { '3': 30 },
    });

    expect(outcome).toEqual({ kind: 'saved', count: 2 });
    expect(api.batchCreateAnnotations).toHaveBeenCalledTimes(1);
    expect(api.batchCreateAnnotations).toHaveBeenCalledWith({
      path: { campaign_id: 5 },
      body: {
        annotations: [
          annotationBody(SQUARE, 7, { '3': 30 }),
          annotationBody(POINT, 7, { '3': 30 }),
        ],
      },
    });
  });

  it('counts a feature spanning several tiles once', async () => {
    vi.mocked(api.batchCreateAnnotations).mockResolvedValue(apiSuccess({ created_count: 1 }));

    await labelFeaturesInBox({
      campaignId: 5,
      hits: [hit('vector-1', 11, SQUARE), hit('vector-1', 11, SQUARE)],
      labelId: 7,
      fields: [],
      formValues: {},
    });

    const body = vi.mocked(api.batchCreateAnnotations).mock.calls[0][0].body;
    expect(body.annotations).toHaveLength(1);
  });

  it('keeps same-id features from different layers apart', async () => {
    vi.mocked(api.batchCreateAnnotations).mockResolvedValue(apiSuccess({ created_count: 2 }));

    await labelFeaturesInBox({
      campaignId: 5,
      hits: [hit('vector-1', 11, SQUARE), hit('vector-2', 11, POINT)],
      labelId: 7,
      fields: [],
      formValues: {},
    });

    const body = vi.mocked(api.batchCreateAnnotations).mock.calls[0][0].body;
    expect(body.annotations).toHaveLength(2);
  });

  it('falls back to the geometry when the tiles carry no feature ids', async () => {
    vi.mocked(api.batchCreateAnnotations).mockResolvedValue(apiSuccess({ created_count: 1 }));

    await labelFeaturesInBox({
      campaignId: 5,
      hits: [hit('vector-1', undefined, SQUARE), hit('vector-1', undefined, SQUARE)],
      labelId: 7,
      fields: [],
      formValues: {},
    });

    const body = vi.mocked(api.batchCreateAnnotations).mock.calls[0][0].body;
    expect(body.annotations).toHaveLength(1);
  });

  it('does nothing when the box caught nothing', async () => {
    const outcome = await labelFeaturesInBox({
      campaignId: 5,
      hits: [],
      labelId: 7,
      fields: [],
      formValues: {},
    });

    expect(outcome).toEqual({ kind: 'noop' });
    expect(api.batchCreateAnnotations).not.toHaveBeenCalled();
  });

  it('blocks on unanswered required fields instead of batching', async () => {
    const outcome = await labelFeaturesInBox({
      campaignId: 5,
      hits: [hit('vector-1', 11, SQUARE)],
      labelId: 7,
      fields: REQUIRED_FIELDS,
      formValues: {},
    });

    expect(outcome).toEqual({ kind: 'blocked', missing: ['Crop'] });
    expect(api.batchCreateAnnotations).not.toHaveBeenCalled();
  });
});
