import { describe, expect, it, beforeEach } from 'vitest';
import { useMapStore } from './map.store';

describe('custom map overlay state', () => {
  beforeEach(() => {
    useMapStore.setState({ activeCustomMapId: null, customMapOpacity: 100, showCustomMap: true });
  });

  it('sets active custom map and opacity', () => {
    useMapStore.getState().setActiveCustomMapId(7);
    useMapStore.getState().setCustomMapOpacity(40);
    expect(useMapStore.getState().activeCustomMapId).toBe(7);
    expect(useMapStore.getState().customMapOpacity).toBe(40);
  });

  it('round-trips overlay state through view snapshots', () => {
    const s = useMapStore.getState();
    s.setActiveCustomMapId(3);
    s.setCustomMapOpacity(55);
    s.saveViewSnapshot(1);
    s.setActiveCustomMapId(null);
    s.restoreViewSnapshot(1, null);
    expect(useMapStore.getState().activeCustomMapId).toBe(3);
    expect(useMapStore.getState().customMapOpacity).toBe(55);
  });
});
