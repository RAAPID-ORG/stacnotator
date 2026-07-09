import { describe, it, expect, beforeEach } from 'vitest';
import type { CustomMapOut } from '~/api/client';
import { useMapStore } from '../stores/map.store';
import { readyCustomMaps, toggleCustomMap, cycleCustomMap } from './customMapNav';

const map = (id: number, over: Partial<CustomMapOut> = {}): CustomMapOut =>
  ({
    id,
    campaign_id: 1,
    name: `Map ${id}`,
    cog_url: 'https://example.com/x.tif',
    render_config: { mode: 'continuous', band: 1, colormap_name: 'viridis', rescale: [0, 1] },
    max_native_zoom: null,
    status: 'ready',
    status_error: null,
    tile_url: `https://tiles.example.com/${id}/{z}/{x}/{y}.png`,
    ...over,
  }) as CustomMapOut;

const READY_1 = map(1);
const READY_2 = map(2);
const READY_3 = map(3);
const REGISTERING = map(4, { status: 'registering', tile_url: null });
const NO_TILE = map(5, { tile_url: null });

beforeEach(() => {
  useMapStore.setState({ activeCustomMapId: null, showCustomMap: true });
});

describe('readyCustomMaps', () => {
  it('keeps only ready maps with a tile_url', () => {
    expect(readyCustomMaps([READY_1, REGISTERING, NO_TILE])).toEqual([READY_1]);
  });
});

describe('toggleCustomMap', () => {
  it('from hidden/none selects the first ready map and shows it', () => {
    useMapStore.setState({ activeCustomMapId: null, showCustomMap: false });
    toggleCustomMap([READY_1, READY_2]);
    expect(useMapStore.getState().activeCustomMapId).toBe(READY_1.id);
    expect(useMapStore.getState().showCustomMap).toBe(true);
  });

  it('while shown hides without clearing the active id (re-enter guarantee)', () => {
    useMapStore.setState({ activeCustomMapId: READY_2.id, showCustomMap: true });
    toggleCustomMap([READY_1, READY_2]);
    expect(useMapStore.getState().showCustomMap).toBe(false);
    expect(useMapStore.getState().activeCustomMapId).toBe(READY_2.id);
  });

  it('from hidden with a valid active id re-shows that same id (no reset to first)', () => {
    useMapStore.setState({ activeCustomMapId: READY_2.id, showCustomMap: false });
    toggleCustomMap([READY_1, READY_2]);
    expect(useMapStore.getState().activeCustomMapId).toBe(READY_2.id);
    expect(useMapStore.getState().showCustomMap).toBe(true);
  });

  it('falls back to first ready map when the active id is no longer ready', () => {
    useMapStore.setState({ activeCustomMapId: 999, showCustomMap: false });
    toggleCustomMap([READY_1, READY_2]);
    expect(useMapStore.getState().activeCustomMapId).toBe(READY_1.id);
    expect(useMapStore.getState().showCustomMap).toBe(true);
  });

  it('is a no-op when there are no ready maps', () => {
    useMapStore.setState({ activeCustomMapId: null, showCustomMap: false });
    toggleCustomMap([REGISTERING, NO_TILE]);
    expect(useMapStore.getState().activeCustomMapId).toBeNull();
    expect(useMapStore.getState().showCustomMap).toBe(false);
  });
});

describe('cycleCustomMap', () => {
  it('advances to the next ready id and shows it', () => {
    useMapStore.setState({ activeCustomMapId: READY_1.id, showCustomMap: false });
    cycleCustomMap([READY_1, READY_2, READY_3]);
    expect(useMapStore.getState().activeCustomMapId).toBe(READY_2.id);
    expect(useMapStore.getState().showCustomMap).toBe(true);
  });

  it('wraps from the last ready map back to the first', () => {
    useMapStore.setState({ activeCustomMapId: READY_3.id, showCustomMap: true });
    cycleCustomMap([READY_1, READY_2, READY_3]);
    expect(useMapStore.getState().activeCustomMapId).toBe(READY_1.id);
  });

  it('from none selects the first ready map', () => {
    useMapStore.setState({ activeCustomMapId: null, showCustomMap: false });
    cycleCustomMap([READY_1, READY_2]);
    expect(useMapStore.getState().activeCustomMapId).toBe(READY_1.id);
    expect(useMapStore.getState().showCustomMap).toBe(true);
  });

  it('is a no-op when there are no ready maps', () => {
    useMapStore.setState({ activeCustomMapId: null, showCustomMap: false });
    cycleCustomMap([REGISTERING]);
    expect(useMapStore.getState().activeCustomMapId).toBeNull();
    expect(useMapStore.getState().showCustomMap).toBe(false);
  });
});
