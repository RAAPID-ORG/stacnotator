import { describe, expect, it, vi } from 'vitest';
import Observable from 'ol/Observable';
import type OLMap from 'ol/Map';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { createRasterReplacementBridge } from './rasterReplacementBridge';

class MapEvents extends Observable {
  render = vi.fn();
  getSize = () => [100, 100];
}

function layers() {
  const outgoing = new TileLayer({ source: new XYZ() });
  const source = new XYZ();
  const replacement = new TileLayer({ source });
  return { outgoing, source, replacement };
}

describe('raster replacement bridge', () => {
  it('retires a memory-cached replacement after that layer paints', () => {
    const map = new MapEvents();
    const { outgoing, replacement } = layers();
    vi.spyOn(replacement, 'getData').mockReturnValue(new Uint8Array([0, 0, 0, 0]));
    const bridge = createRasterReplacementBridge(map as unknown as OLMap, () => true);

    bridge.retire('old', outgoing, replacement);
    expect(outgoing.getVisible()).toBe(true);
    replacement.dispatchEvent('postrender');
    expect(outgoing.getVisible()).toBe(false);

    bridge.dispose();
  });

  it('waits for the replacement tiles and its following paint', () => {
    const map = new MapEvents();
    const { outgoing, source, replacement } = layers();
    vi.spyOn(replacement, 'getData')
      .mockReturnValueOnce(null)
      .mockReturnValue(new Uint8Array([0, 0, 0, 0]));
    const bridge = createRasterReplacementBridge(map as unknown as OLMap, () => true);

    bridge.retire('old', outgoing, replacement);
    source.dispatchEvent('tileloadstart');
    replacement.dispatchEvent('postrender');
    expect(outgoing.getVisible()).toBe(true);

    source.dispatchEvent('tileloadend');
    expect(outgoing.getVisible()).toBe(true);
    replacement.dispatchEvent('postrender');
    expect(outgoing.getVisible()).toBe(false);

    bridge.dispose();
  });

  it('retires immediately on camera movement', () => {
    const map = new MapEvents();
    const { outgoing, replacement } = layers();
    const bridge = createRasterReplacementBridge(map as unknown as OLMap, () => true);

    bridge.retire('old', outgoing, replacement);
    map.dispatchEvent('movestart');
    expect(outgoing.getVisible()).toBe(false);

    bridge.dispose();
  });
});
