import type Tile from 'ol/Tile';
import TileLayer from 'ol/layer/Tile';
import type CanvasTileLayerRenderer from 'ol/renderer/canvas/TileLayer';
import type XYZ from 'ol/source/XYZ';
import TileState from 'ol/TileState';
import { unByKey } from 'ol/Observable';

const RETRY_DELAYS_MS = [250, 1_000] as const;
const attempts = new WeakMap<Tile, number>();
const detachByLayer = new WeakMap<TileLayer<XYZ>, () => void>();

function retry(tile: Tile): void {
  if (tile.getState() !== TileState.ERROR) return;
  const attempt = attempts.get(tile) ?? 0;
  if (attempt >= RETRY_DELAYS_MS.length) return;
  attempts.set(tile, attempt + 1);
  tile.load();
}

/**
 * Recover transient foreground failures without letting hidden dates continue
 * fetching. OpenLayers otherwise keeps an errored tile terminal for the life of
 * its source, which presents as a permanent white square.
 */
export function attachTileErrorRecovery(layer: TileLayer<XYZ>): void {
  detachTileErrorRecovery(layer);
  const source = layer.getSource();
  if (!source) return;

  const errorKey = source.on('tileloaderror', ({ tile }) => {
    const attempt = attempts.get(tile) ?? 0;
    if (attempt >= RETRY_DELAYS_MS.length) return;
    window.setTimeout(() => {
      if (layer.getVisible() && layer.getSource() === source) retry(tile);
    }, RETRY_DELAYS_MS[attempt]);
  });
  const endKey = source.on('tileloadend', ({ tile }) => attempts.delete(tile));
  detachByLayer.set(layer, () => {
    unByKey([errorKey, endKey]);
    detachByLayer.delete(layer);
  });
}

export function detachTileErrorRecovery(layer: TileLayer<XYZ>): void {
  detachByLayer.get(layer)?.();
}

/** Retry terminal renderer entries when a cached date becomes visible again. */
export function retryErroredTiles(layer: TileLayer<XYZ>): void {
  if (!layer.hasRenderer()) return;
  const renderer = layer.getRenderer() as CanvasTileLayerRenderer;
  let retried = false;
  renderer.getTileCache().forEach((tile: Tile) => {
    if (tile.getState() !== TileState.ERROR) return;
    // A new visibility episode gets a fresh bounded retry budget.
    attempts.delete(tile);
    retry(tile);
    retried = true;
  });
  if (retried) layer.changed();
}
