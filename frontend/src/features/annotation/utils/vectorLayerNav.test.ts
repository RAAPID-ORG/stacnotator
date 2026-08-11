import { describe, it, expect, beforeEach } from 'vitest';
import type { VectorLayerOut } from '~/api/client';
import { useMapStore } from '../stores/map.store';
import { toggleVectorLayer, cycleVectorLayer } from './vectorLayerNav';

const layer = (id: number): VectorLayerOut => ({
  id,
  campaign_id: 1,
  name: `Layer ${id}`,
  pmtiles_url: `https://example.com/${id}.pmtiles`,
  source_layer: null,
  color: '#3b82f6',
  display_order: id,
});

const LAYER_1 = layer(1);
const LAYER_2 = layer(2);
const LAYER_3 = layer(3);

beforeEach(() => {
  useMapStore.setState({ activeVectorLayerId: null, showVectorLayer: true });
});

describe('toggleVectorLayer', () => {
  it('from none selects the first layer and shows it', () => {
    useMapStore.setState({ activeVectorLayerId: null, showVectorLayer: false });
    toggleVectorLayer([LAYER_1, LAYER_2]);
    expect(useMapStore.getState().activeVectorLayerId).toBe(LAYER_1.id);
    expect(useMapStore.getState().showVectorLayer).toBe(true);
  });

  it('while shown hides without clearing the active id (re-enter guarantee)', () => {
    useMapStore.setState({ activeVectorLayerId: LAYER_2.id, showVectorLayer: true });
    toggleVectorLayer([LAYER_1, LAYER_2]);
    expect(useMapStore.getState().showVectorLayer).toBe(false);
    expect(useMapStore.getState().activeVectorLayerId).toBe(LAYER_2.id);
  });

  it('while hidden re-shows the same layer', () => {
    useMapStore.setState({ activeVectorLayerId: LAYER_2.id, showVectorLayer: false });
    toggleVectorLayer([LAYER_1, LAYER_2]);
    expect(useMapStore.getState().activeVectorLayerId).toBe(LAYER_2.id);
    expect(useMapStore.getState().showVectorLayer).toBe(true);
  });

  it('falls back to the first layer when the active id no longer exists', () => {
    useMapStore.setState({ activeVectorLayerId: 99, showVectorLayer: false });
    toggleVectorLayer([LAYER_1, LAYER_2]);
    expect(useMapStore.getState().activeVectorLayerId).toBe(LAYER_1.id);
    expect(useMapStore.getState().showVectorLayer).toBe(true);
  });

  it('does nothing without layers', () => {
    useMapStore.setState({ activeVectorLayerId: null, showVectorLayer: false });
    toggleVectorLayer([]);
    expect(useMapStore.getState().activeVectorLayerId).toBe(null);
    expect(useMapStore.getState().showVectorLayer).toBe(false);
  });
});

describe('cycleVectorLayer', () => {
  it('advances to the next layer and wraps around', () => {
    useMapStore.setState({ activeVectorLayerId: LAYER_2.id });
    cycleVectorLayer([LAYER_1, LAYER_2, LAYER_3]);
    expect(useMapStore.getState().activeVectorLayerId).toBe(LAYER_3.id);
    cycleVectorLayer([LAYER_1, LAYER_2, LAYER_3]);
    expect(useMapStore.getState().activeVectorLayerId).toBe(LAYER_1.id);
  });

  it('starts at the first layer when none is active and shows it', () => {
    useMapStore.setState({ activeVectorLayerId: null, showVectorLayer: false });
    cycleVectorLayer([LAYER_1, LAYER_2]);
    expect(useMapStore.getState().activeVectorLayerId).toBe(LAYER_1.id);
    expect(useMapStore.getState().showVectorLayer).toBe(true);
  });
});
