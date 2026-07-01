import { describe, expect, it, beforeEach } from 'vitest';
import { useMapStore } from './map.store';

describe('vector layer enablement state', () => {
  beforeEach(() => {
    useMapStore.setState({ enabledVectorLayerIds: [] });
  });

  it('enables and disables layers idempotently', () => {
    const s = useMapStore.getState();
    s.setVectorLayerEnabled(3, true);
    s.setVectorLayerEnabled(3, true); // no duplicate
    expect(useMapStore.getState().enabledVectorLayerIds).toEqual([3]);

    s.setVectorLayerEnabled(3, false);
    expect(useMapStore.getState().enabledVectorLayerIds).toEqual([]);

    s.setVectorLayerEnabled(9, false); // disabling an absent id is a no-op
    expect(useMapStore.getState().enabledVectorLayerIds).toEqual([]);
  });

  it('toggles layers on and off', () => {
    const s = useMapStore.getState();
    s.toggleVectorLayer(1);
    s.toggleVectorLayer(2);
    expect(useMapStore.getState().enabledVectorLayerIds).toEqual([1, 2]);
    s.toggleVectorLayer(1);
    expect(useMapStore.getState().enabledVectorLayerIds).toEqual([2]);
  });

  it('replaces the enabled set', () => {
    const s = useMapStore.getState();
    s.setEnabledVectorLayerIds([4, 5, 6]);
    expect(useMapStore.getState().enabledVectorLayerIds).toEqual([4, 5, 6]);
  });
});
