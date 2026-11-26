import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageTile from 'ol/ImageTile';
import TileLayer from 'ol/layer/Tile';
import { TileSourceEvent } from 'ol/source/Tile';
import XYZ from 'ol/source/XYZ';
import TileState from 'ol/TileState';

vi.mock('~/api/tilerToken', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/api/tilerToken')>()),
  expireTilerSession: vi.fn(),
}));

import { expireTilerSession } from '~/api/tilerToken';
import { attachTileErrorRecovery, detachTileErrorRecovery, tileRetryPending } from './tileLoading';

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

  it('mints the scope again when a credentialed tile fails', () => {
    vi.mocked(expireTilerSession).mockClear();
    const source = new XYZ({ url: 'https://tiler/{z}/{x}/{y}.png' });
    attachTileErrorRecovery(new TileLayer({ source }));
    const tile = new ImageTile(
      [15, 1, 2],
      TileState.ERROR,
      'https://tiler/scopes/235/searches/s/tiles/15/1/2.png',
      { crossOrigin: 'use-credentials' },
      vi.fn()
    );
    // What OpenLayers leaves behind after a failed load: a blank canvas, no crossOrigin.
    vi.spyOn(tile, 'getImage').mockReturnValue(document.createElement('canvas'));

    source.dispatchEvent(new TileSourceEvent('tileloaderror', tile));

    expect(expireTilerSession).toHaveBeenCalledExactlyOnceWith('235');
  });

  it('reports a failed tile as pending until its retries are used up', () => {
    vi.useFakeTimers();
    const source = new XYZ({ url: 'https://tiler/{z}/{x}/{y}.png' });
    const layer = new TileLayer({ source });
    const tile = failedTile(() => {});
    attachTileErrorRecovery(layer);
    const fail = () => {
      tile.setState(TileState.ERROR);
      source.dispatchEvent(new TileSourceEvent('tileloaderror', tile));
    };

    fail();
    expect(tileRetryPending(tile)).toBe(true);
    vi.advanceTimersByTime(250);
    expect(tileRetryPending(tile)).toBe(true);
    fail();
    vi.advanceTimersByTime(1_000);
    fail();

    expect(tileRetryPending(tile)).toBe(false);
  });
});
