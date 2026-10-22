import { fromLonLat, toLonLat } from 'ol/proj';
import { tileUrl } from '~/shared/imagery/tileUrls';
import type { Bbox } from '~/shared/map/types';
import { ensureSessionFor, type CrossOrigin } from '~/shared/map/tileLoading';

/** Half the Web Mercator world width, in metres. */
const HALF_WORLD = 20037508.342789244;
/** Planning assumes 256px tiles; a source serving 512px tiles just yields a
 *  sharper image, since stitching measures the tiles it actually got. */
const PLAN_TILE_PX = 256;
const MAX_TILES = 64;

/** An EPSG:3857 extent: [minX, minY, maxX, maxY]. */
export type Extent = [number, number, number, number];

export interface MosaicPlan {
  z: number;
  /** Inclusive tile range. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The extent the stitched image covers once cropped. */
  extent: Extent;
}

export interface Mosaic {
  image: ImageData;
  extent: Extent;
  z: number;
  /** Ground metres per image pixel, measured along the equator scale. */
  metresPerPixel: number;
}

export function bboxToExtent(bbox: Bbox): Extent {
  const [minX, minY] = fromLonLat([bbox[0], bbox[1]]);
  const [maxX, maxY] = fromLonLat([bbox[2], bbox[3]]);
  return [minX, minY, maxX, maxY];
}

/** Grow an extent by `ratio` of its size on every side, plus at least `minMetres`. */
export function padExtent(extent: Extent, ratio: number, minMetres = 0): Extent {
  const padX = Math.max((extent[2] - extent[0]) * ratio, minMetres);
  const padY = Math.max((extent[3] - extent[1]) * ratio, minMetres);
  return [extent[0] - padX, extent[1] - padY, extent[2] + padX, extent[3] + padY];
}

const tileSpan = (z: number) => (2 * HALF_WORLD) / 2 ** z;

/** Ground size of a pixel at zoom `z`, in Web Mercator metres. */
export const metresPerPixelAt = (z: number): number => tileSpan(z) / PLAN_TILE_PX;

/** Grow an extent about its centre until each side is at least `minSide`. */
export function growToSide(extent: Extent, minSide: number): Extent {
  const cx = (extent[0] + extent[2]) / 2;
  const cy = (extent[1] + extent[3]) / 2;
  const hw = Math.max(extent[2] - extent[0], minSide) / 2;
  const hh = Math.max(extent[3] - extent[1], minSide) / 2;
  return [cx - hw, cy - hh, cx + hw, cy + hh];
}

/** Side length in pixels the extent would span at zoom `z`. */
export function extentPixels(extent: Extent, z: number): { width: number; height: number } {
  const span = tileSpan(z) / PLAN_TILE_PX;
  return { width: (extent[2] - extent[0]) / span, height: (extent[3] - extent[1]) / span };
}

/**
 * The sharpest zoom at or below `maxZoom` whose image of `extent` stays within
 * `maxSide` pixels. The models resize to about 1024px whatever they are given,
 * so pixels beyond that only cost downloads.
 */
export function chooseZoom(extent: Extent, maxZoom: number, maxSide: number): number {
  let z = Math.max(0, Math.floor(maxZoom));
  while (z > 0) {
    const { width, height } = extentPixels(extent, z);
    const plan = planMosaic(extent, z);
    const tiles = (plan.x1 - plan.x0 + 1) * (plan.y1 - plan.y0 + 1);
    if (Math.max(width, height) <= maxSide && tiles <= MAX_TILES) break;
    z--;
  }
  return z;
}

export function planMosaic(extent: Extent, z: number): MosaicPlan {
  const span = tileSpan(z);
  const last = 2 ** z - 1;
  const clamp = (v: number) => Math.min(last, Math.max(0, v));
  return {
    z,
    x0: clamp(Math.floor((extent[0] + HALF_WORLD) / span)),
    x1: clamp(Math.floor((extent[2] + HALF_WORLD) / span)),
    y0: clamp(Math.floor((HALF_WORLD - extent[3]) / span)),
    y1: clamp(Math.floor((HALF_WORLD - extent[1]) / span)),
    extent,
  };
}

/** Where the plan's extent falls inside the stitched tile grid, in pixels. */
export function cropRect(
  plan: MosaicPlan,
  tilePx: number
): { x: number; y: number; width: number; height: number } {
  const span = tileSpan(plan.z);
  const left = plan.x0 * span - HALF_WORLD;
  const top = HALF_WORLD - plan.y0 * span;
  const scale = tilePx / span;
  const x = (plan.extent[0] - left) * scale;
  const y = (top - plan.extent[3]) * scale;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round((plan.extent[2] - left) * scale - x)),
    height: Math.max(1, Math.round((top - plan.extent[1]) * scale - y)),
  };
}

async function fetchTile(
  url: string,
  crossOrigin: CrossOrigin,
  signal?: AbortSignal
): Promise<ImageBitmap | null> {
  const response = await fetch(url, {
    mode: 'cors',
    credentials: crossOrigin === 'use-credentials' ? 'include' : 'omit',
    signal,
  });
  // Tilers answer "nothing here" with 204 or 404; that part of the image is
  // simply empty, like on the map.
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Tile request failed: ${response.status}`);
  return createImageBitmap(await response.blob());
}

/**
 * The imagery under `extent` as one image, stitched from the source's own
 * tiles at zoom `z`. The tiles come through the same CORS and cookie rules as
 * the map's, which is what makes their pixels readable.
 */
export async function fetchMosaic(
  template: string,
  plan: MosaicPlan,
  crossOrigin: CrossOrigin,
  signal?: AbortSignal
): Promise<Mosaic> {
  await ensureSessionFor(crossOrigin);
  const jobs: Array<Promise<{ dx: number; dy: number; bitmap: ImageBitmap | null }>> = [];
  for (let y = plan.y0; y <= plan.y1; y++) {
    for (let x = plan.x0; x <= plan.x1; x++) {
      const url = tileUrl(template, plan.z, x, y);
      jobs.push(
        fetchTile(url, crossOrigin, signal).then((bitmap) => ({
          dx: x - plan.x0,
          dy: y - plan.y0,
          bitmap,
        }))
      );
    }
  }
  const tiles = await Promise.all(jobs);
  const tilePx = tiles.find((t) => t.bitmap)?.bitmap?.width;
  if (!tilePx) throw new Error('No imagery under the box');

  const rect = cropRect(plan, tilePx);
  const canvas = new OffscreenCanvas(rect.width, rect.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  for (const { dx, dy, bitmap } of tiles) {
    if (!bitmap) continue;
    ctx.drawImage(bitmap, dx * tilePx - rect.x, dy * tilePx - rect.y, tilePx, tilePx);
    bitmap.close();
  }
  return {
    image: ctx.getImageData(0, 0, rect.width, rect.height),
    extent: plan.extent,
    z: plan.z,
    metresPerPixel: (plan.extent[2] - plan.extent[0]) / rect.width,
  };
}

/** Image pixel -> lon/lat, for an image covering `extent` at `width` x `height`. */
export function pixelToLonLat(
  extent: Extent,
  width: number,
  height: number
): (px: number, py: number) => [number, number] {
  const sx = (extent[2] - extent[0]) / width;
  const sy = (extent[3] - extent[1]) / height;
  return (px, py) => {
    const [lon, lat] = toLonLat([extent[0] + px * sx, extent[3] - py * sy]);
    return [lon, lat];
  };
}
