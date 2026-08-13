import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '~/api/client';
import type { AnnotationOut, CampaignOutFull } from '~/api/client';
import { buildCatalog } from '~/features/annotation/core/catalog';
import {
  apiSuccess,
  makeAnnotation,
  makeCampaign,
} from '~/features/annotation/core/catalog/testHelpers';
import { useWorkStore } from '~/features/annotation/stores';
import type { MapClickEvent } from '~/features/annotation/engine/map';
import type { ComposeCtx } from '../composition';
import { ANNOTATION_LAYER_ID } from '../shared/composeLayers';
import {
  clearEditSession,
  getEditSession,
  openEdit,
  setEditAnnotation,
  setPendingGeometry,
} from '../shared/editSession';
import { resetInteractionSpec, useInteractionSpec } from '../shared/interactionSpec';
import { getActiveTool, resetToolState, selectTool } from '../shared/toolState';
import { commitEdit, deleteSelection, handleMapClick } from './useDrawingInteractions';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return {
    ...actual,
    getAnnotation: vi.fn(),
    updateAnnotationOpenmode: vi.fn(),
    deleteAnnotation: vi.fn(),
    batchDeleteAnnotations: vi.fn(),
  };
});

const CAMPAIGN: CampaignOutFull = makeCampaign({ id: 7 });
const CTX: ComposeCtx = {
  campaign: CAMPAIGN,
  catalog: buildCatalog(CAMPAIGN),
  view: null,
  mode: 'explore',
  isMobile: false,
};

const ANNOTATION: AnnotationOut = makeAnnotation({ id: 5 });

const MOVED: GeoJSON.Geometry = { type: 'Point', coordinates: [3, 4] };

function click(over: Partial<MapClickEvent> = {}): MapClickEvent {
  return { lonLat: [0, 0], shiftKey: false, ...over };
}

const onAnnotation = (id: number) => click({ layerId: ANNOTATION_LAYER_ID, featureId: id });

beforeEach(async () => {
  vi.mocked(api.getAnnotation).mockReset().mockResolvedValue(apiSuccess(ANNOTATION));
  vi.mocked(api.updateAnnotationOpenmode).mockReset().mockResolvedValue(apiSuccess(ANNOTATION));
  vi.mocked(api.deleteAnnotation).mockReset().mockResolvedValue(apiSuccess(null));
  vi.mocked(api.batchDeleteAnnotations)
    .mockReset()
    .mockResolvedValue(apiSuccess({ deleted_count: 2 }));
  clearEditSession();
  resetInteractionSpec();
  resetToolState();
  await selectTool('edit', CTX);
});

describe('handleMapClick with the time-series probe', () => {
  it('keeps the selected point but returns to pan after one click', async () => {
    await selectTool('timeseries', CTX);

    await handleMapClick(CTX, click({ lonLat: [3, 4] }));

    expect(useInteractionSpec.getState().probePoint).toEqual([3, 4]);
    expect(getActiveTool()).toBe('pan');
  });
});

describe('handleMapClick with the edit tool', () => {
  // The tile copy of the annotation being edited is rendered transparent and
  // the handles live on the sketch layer, which is not a declared layer, so a
  // click on the shape being edited reports no feature at all. Ending the
  // edit on that would throw away an unsaved drag.
  it('keeps the open edit when the click reports no feature', async () => {
    await openEdit(7, 5);

    await handleMapClick(CTX, click());

    expect(useWorkStore.getState().editingId).toBe(5);
    expect(useWorkStore.getState().selection).toEqual([5]);
    expect(getEditSession().annotation).not.toBeNull();
  });

  it('keeps a dragged, unsaved geometry when the click reports no feature', async () => {
    await openEdit(7, 5);
    setPendingGeometry(MOVED);

    await handleMapClick(CTX, click());

    expect(getEditSession().pending).toEqual(MOVED);
  });

  it('drops a box selection when the click reports no feature', async () => {
    useWorkStore.getState().setSelection([1, 2]);

    await handleMapClick(CTX, click());

    expect(useWorkStore.getState().selection).toEqual([]);
  });

  it('opens the annotation that was clicked', async () => {
    await handleMapClick(CTX, onAnnotation(5));

    expect(api.getAnnotation).toHaveBeenCalledWith({
      path: { campaign_id: 7, annotation_id: 5 },
    });
    expect(useWorkStore.getState().editingId).toBe(5);
  });

  it('does not restart the edit when the annotation already open is clicked', async () => {
    await openEdit(7, 5);
    setPendingGeometry(MOVED);
    vi.mocked(api.getAnnotation).mockClear();

    await handleMapClick(CTX, onAnnotation(5));

    expect(api.getAnnotation).not.toHaveBeenCalled();
    expect(getEditSession().pending).toEqual(MOVED);
  });
});

describe('commitEdit', () => {
  // The panel and the map edit the same annotation through separate features;
  // the geometry save must send what the detail save just wrote, not the copy
  // fetched before it.
  it('sends the label a detail save wrote, not the one that was fetched', async () => {
    await openEdit(7, 5);
    // What EditDetails does after its own successful save.
    setEditAnnotation({ ...ANNOTATION, label_id: 2 });
    setPendingGeometry(MOVED);

    expect(await commitEdit(7)).toBe(true);

    expect(api.updateAnnotationOpenmode).toHaveBeenCalledWith({
      path: { campaign_id: 7, annotation_id: 5 },
      body: { label_id: 2, comment: null, geometry_wkt: 'POINT (3 4)', is_authoritative: null },
    });
  });

  // null is a write value ("clear the answers"), so a geometry-only edit must
  // leave the key out entirely.
  it('omits form_values when the annotation has no stored answers', async () => {
    await openEdit(7, 5);
    setPendingGeometry(MOVED);

    await commitEdit(7);

    const { body } = vi.mocked(api.updateAnnotationOpenmode).mock.calls[0][0];
    expect('form_values' in body).toBe(false);
  });

  it('sends the stored answers back untouched when there are some', async () => {
    vi.mocked(api.getAnnotation).mockResolvedValue(
      apiSuccess({ ...ANNOTATION, form_values: { '1': 'kept' } })
    );
    await openEdit(7, 5);
    setPendingGeometry(MOVED);

    await commitEdit(7);

    const { body } = vi.mocked(api.updateAnnotationOpenmode).mock.calls[0][0];
    expect(body.form_values).toEqual({ '1': 'kept' });
  });

  it('does nothing without a dragged geometry', async () => {
    await openEdit(7, 5);
    expect(await commitEdit(7)).toBe(false);
    expect(api.updateAnnotationOpenmode).not.toHaveBeenCalled();
  });
});

describe('deleteSelection', () => {
  it('drops the selection before the request, so a second Delete cannot repeat it', async () => {
    let selectionDuringRequest: number[] | null = null;
    vi.mocked(api.deleteAnnotation).mockImplementation(async () => {
      selectionDuringRequest = useWorkStore.getState().selection;
      return apiSuccess(null);
    });
    await openEdit(7, 5);

    expect(await deleteSelection(7)).toBe(1);

    expect(selectionDuringRequest).toEqual([]);
    expect(await deleteSelection(7)).toBe(0);
    expect(api.deleteAnnotation).toHaveBeenCalledTimes(1);
  });

  it('deletes a box selection in one request', async () => {
    useWorkStore.getState().setSelection([1, 2]);

    expect(await deleteSelection(7)).toBe(2);

    expect(api.batchDeleteAnnotations).toHaveBeenCalledWith({
      path: { campaign_id: 7 },
      body: { annotation_ids: [1, 2] },
    });
  });
});
