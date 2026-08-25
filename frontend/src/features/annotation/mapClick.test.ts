import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/api/client', async (importActual) => {
  const actual = await importActual<typeof import('~/api/client')>();
  return { ...actual, getAnnotation: vi.fn() };
});

import { getAnnotation } from '~/api/client';
import { handleMapClick } from './drawing';
import { ANNOTATION_LAYER_ID } from './map/compose';
import type { MapClickEvent } from '~/shared/map/types';
import { useWorkStore } from './stores/work';
import { apiSuccess, makeAnnotation, makeCampaign } from './testing/fixtures';
import { seedCampaign } from './testing/seed';

const click = (overrides: Partial<MapClickEvent> = {}): MapClickEvent => ({
  lonLat: [0, 0],
  shiftKey: false,
  ...overrides,
});

const onAnnotation = (id: number) => click({ layerId: ANNOTATION_LAYER_ID, featureId: id });

beforeEach(() => {
  seedCampaign(makeCampaign({ id: 5 }));
  vi.mocked(getAnnotation).mockReset();
  vi.mocked(getAnnotation).mockResolvedValue(
    apiSuccess(makeAnnotation({ id: 7, geometry: { id: 1, geometry: 'POINT (3 4)' } }))
  );
  useWorkStore.setState({ tool: 'pan', selection: [], selectionAnchor: null, edit: null });
});

// Reading an annotation is not editing it: Pan opens the record and anchors the
// controls on it, and the edit tool is what adds vertex handles on top.
describe('clicking an annotation in Pan', () => {
  it('opens the record and anchors its controls on the geometry', async () => {
    await handleMapClick(onAnnotation(7));

    const state = useWorkStore.getState();
    expect(state.edit?.annotation.id).toBe(7);
    expect(state.selection).toEqual([7]);
    expect(state.selectionAnchor).toEqual([3, 4]);
  });

  it('closes it again on a click that hits nothing', async () => {
    await handleMapClick(onAnnotation(7));
    await handleMapClick(click());

    expect(useWorkStore.getState().edit).toBeNull();
    expect(useWorkStore.getState().selectionAnchor).toBeNull();
  });

  it('leaves the map alone while a box gesture is ending', async () => {
    await handleMapClick(click({ ...onAnnotation(7), shiftKey: true }));
    expect(getAnnotation).not.toHaveBeenCalled();
  });
});
