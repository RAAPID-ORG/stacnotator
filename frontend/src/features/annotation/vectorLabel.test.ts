import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/api/client', async (importActual) => {
  const actual = await importActual<typeof import('~/api/client')>();
  return {
    ...actual,
    createAnnotationOpenmode: vi.fn(),
    batchCreateAnnotations: vi.fn(),
  };
});

import * as api from '~/api/client';
import { annotationBody, dedupeHits, labelGeometries } from './drawing';
import type { FormField, FormValues } from './domain/annotation';
import type { BoxHit } from './map/types';
import { useWorkStore } from './stores/work';
import { apiSuccess, makeAnnotation, makeCampaign } from './testing/fixtures';
import { seedCampaign } from './testing/seed';

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
const POINT: GeoJSON.Geometry = { type: 'Point', coordinates: [5, 6] };

const REQUIRED_FIELDS: FormField[] = [{ id: 3, title: 'Crop', type: 'text', required: true }];

const hit = (layerId: string, id: number, geometry: GeoJSON.Geometry): BoxHit => ({
  layerId,
  feature: { id, geometry },
});

/** The label and the answers come from the work store, so a case declares
 *  them by seeding rather than by argument. */
function seed(fields: FormField[] = [], formValues: FormValues = {}) {
  const base = makeCampaign();
  seedCampaign(makeCampaign({ id: 5, settings: { ...base.settings, form_fields: fields } }));
  useWorkStore.setState({ selectedLabelId: 7, formValues });
}

beforeEach(() => {
  vi.mocked(api.createAnnotationOpenmode).mockReset();
  vi.mocked(api.batchCreateAnnotations).mockReset();
  seed();
});

describe('annotationBody', () => {
  it('carries the geometry as WKT and omits an empty answer set', () => {
    expect(annotationBody(POINT, 7, {})).toEqual({
      label_id: 7,
      comment: null,
      geometry_wkt: 'POINT (5 6)',
      confidence: null,
      form_values: null,
    });
  });

  it('sends the answers when there are some', () => {
    expect(annotationBody(POINT, 7, { '3': 30 }).form_values).toEqual({ '3': 30 });
  });
});

describe('dedupeHits', () => {
  it('keeps one geometry per feature, even when it spans several tiles', () => {
    const hits = [
      hit('vector-1', 11, SQUARE),
      hit('vector-1', 11, SQUARE),
      hit('vector-1', 12, POINT),
    ];
    expect(dedupeHits(hits)).toEqual([SQUARE, POINT]);
  });

  it('treats the same id on a different layer as a different feature', () => {
    expect(dedupeHits([hit('vector-1', 11, SQUARE), hit('vector-2', 11, POINT)])).toHaveLength(2);
  });
});

describe('labelGeometries', () => {
  it('creates one annotation from a single clicked feature', async () => {
    vi.mocked(api.createAnnotationOpenmode).mockResolvedValue(apiSuccess(makeAnnotation()));

    expect(await labelGeometries([SQUARE])).toEqual({ kind: 'saved', count: 1 });
    expect(api.createAnnotationOpenmode).toHaveBeenCalledWith({
      path: { campaign_id: 5 },
      body: annotationBody(SQUARE, 7, {}),
    });
  });

  it('sends a boxed set as one batch and reports what was created', async () => {
    seed([], { '3': 30 });
    vi.mocked(api.batchCreateAnnotations).mockResolvedValue(apiSuccess({ created_count: 2 }));

    expect(await labelGeometries([SQUARE, POINT])).toEqual({ kind: 'saved', count: 2 });
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

  it('blocks on unanswered required fields instead of saving', async () => {
    seed(REQUIRED_FIELDS);

    expect(await labelGeometries([SQUARE])).toEqual({ kind: 'blocked', missing: ['Crop'] });
    expect(api.createAnnotationOpenmode).not.toHaveBeenCalled();
    expect(api.batchCreateAnnotations).not.toHaveBeenCalled();
  });

  it('does nothing when the box caught nothing', async () => {
    expect(await labelGeometries([])).toEqual({ kind: 'noop' });
    expect(api.batchCreateAnnotations).not.toHaveBeenCalled();
  });

  it('does nothing when no label is armed', async () => {
    useWorkStore.setState({ selectedLabelId: null });
    expect(await labelGeometries([SQUARE])).toEqual({ kind: 'noop' });
    expect(api.createAnnotationOpenmode).not.toHaveBeenCalled();
  });

  it('reports a failed save rather than throwing', async () => {
    vi.mocked(api.createAnnotationOpenmode).mockRejectedValue(new Error('boom'));
    expect(await labelGeometries([SQUARE])).toMatchObject({ kind: 'error' });
  });
});
