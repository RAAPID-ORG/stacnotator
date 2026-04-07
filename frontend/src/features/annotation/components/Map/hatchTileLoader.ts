/**
 * Custom tile load function that shows a diagonal hatching pattern
 * for confirmed 204 (no content) responses. Normal tiles load as usual.
 *
 * Reports 204 tile URLs via subscribers so consumers can detect
 * empty slices without extra network requests.
 */
import type ImageTile from 'ol/ImageTile';
import { getTilerToken } from '~/api/tilerToken';

let _hatchDataUrl: string | null = null;

function getHatchDataUrl(): string {
  if (_hatchDataUrl) return _hatchDataUrl;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#d4d4d4';
  ctx.lineWidth = 1;
  const step = 10;
  for (let i = -size; i < size * 2; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }
  _hatchDataUrl = canvas.toDataURL();
  return _hatchDataUrl;
}

/** Subscribe to 204 tile reports. Returns unsubscribe function. */
export type OnTileEmpty = (tileUrl: string) => void;
const _subscribers = new Set<OnTileEmpty>();

export function subscribeToEmptyTiles(cb: OnTileEmpty): () => void {
  _subscribers.add(cb);
  return () => _subscribers.delete(cb);
}

export function tileLoadWithHatch(tile: ImageTile, src: string): void {
  const img = tile.getImage() as HTMLImageElement;
  getTilerToken()
    .then((token) => fetch(src, { mode: 'cors', headers: { Authorization: `Bearer ${token}` } }))
    .then((resp) => {
      if (resp.status === 204) {
        img.src = getHatchDataUrl();
        for (const cb of _subscribers) cb(src);
        return;
      }
      return resp.blob().then((blob) => {
        img.src = URL.createObjectURL(blob);
      });
    })
    .catch(() => {
      img.src = '';
    });
}
