import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageTile from 'ol/ImageTile';
import TileLayer from 'ol/layer/Tile';
import { TileSourceEvent } from 'ol/source/Tile';
import XYZ from 'ol/source/XYZ';
import TileState from 'ol/TileState';
import { attachTileErrorRecovery, detachTileErrorRecovery } from './tileLoading';

function failedTile(load: () => void): ImageTile {
  return new ImageTile(
    [15, 1, 2],
    TileState.ERROR,
    'https://tiler/15/1/2.png',
    { crossOrigin: null },
    load
  );
}

afterEach(() => vi.useRealTimers());

describe('attachTileErrorRecovery', () => {
  it('retries a transient error while its layer is still visible', () => {
    vi.useFakeTimers();
    const source = new XYZ({ url: 'https://tiler/{z}/{x}/{y}.png' });
    const layer = new TileLayer({ source });
    const load = vi.fn();
    const tile = failedTile(load);
    attachTileErrorRecovery(layer);

    source.dispatchEvent(new TileSourceEvent('tileloaderror', tile));
    vi.advanceTimersByTime(249);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(load).toHaveBeenCalledOnce();
    expect(tile.getState()).toBe(TileState.LOADING);
  });

  it('does not retry imagery after its layer has been hidden', () => {
    vi.useFakeTimers();
    const source = new XYZ({ url: 'https://tiler/{z}/{x}/{y}.png' });
    const layer = new TileLayer({ source });
    const load = vi.fn();
    const tile = failedTile(load);
    attachTileErrorRecovery(layer);

    source.dispatchEvent(new TileSourceEvent('tileloaderror', tile));
    layer.setVisible(false);
    vi.runAllTimers();

    expect(load).not.toHaveBeenCalled();
  });

  it('stops observing a source when its layer is destroyed', () => {
    vi.useFakeTimers();
    const source = new XYZ({ url: 'https://tiler/{z}/{x}/{y}.png' });
    const layer = new TileLayer({ source });
    const load = vi.fn();
    const tile = failedTile(load);
    attachTileErrorRecovery(layer);

    detachTileErrorRecovery(layer);
    source.dispatchEvent(new TileSourceEvent('tileloaderror', tile));
    vi.runAllTimers();

    expect(load).not.toHaveBeenCalled();
  });
});
