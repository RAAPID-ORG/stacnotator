/**
 * Binary mask -> polygons, in pixel coordinates (y down, pixel corners on the
 * integer grid). Each 4-connected component becomes one polygon: its outer
 * boundary plus a ring per hole, traced along pixel edges and then simplified.
 */

export type Ring = Array<[number, number]>;
/** Outer ring first, holes after - the GeoJSON polygon layout. */
export type PixelPolygon = Ring[];

export interface TraceOptions {
  /** Components smaller than this many pixels are dropped. */
  minArea?: number;
  /** Holes smaller than this many pixels are filled. */
  minHoleArea?: number;
  /** Douglas-Peucker tolerance, in pixels. */
  tolerance?: number;
}

/** 4-connected component labels (0 = background), and each label's pixel count. */
export function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number
): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(width * height);
  const sizes = [0];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = sizes.length;
    let size = 0;
    labels[start] = label;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        i - width,
        i + width < mask.length ? i + width : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && mask[n] && !labels[n]) {
          labels[n] = label;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** Signed shoelace area. Outer rings traced here come out negative (clockwise
 *  on a y-down grid, so counter-clockwise once y points up), holes positive. */
export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

/**
 * Fill one background pixel of every 2x2 block whose foreground touches only
 * diagonally. Without such a saddle every boundary vertex has exactly one way
 * out, so tracing is unambiguous and no ring can touch itself - a ring that
 * does is invalid to PostGIS. Repeats until no saddle is left, since a fill
 * can create one next to it.
 */
export function removeSaddles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = mask.slice();
  for (let changed = true; changed; ) {
    changed = false;
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const i = y * width + x;
        const a = out[i];
        const b = out[i + 1];
        const c = out[i + width];
        const d = out[i + width + 1];
        if (a && d && !b && !c) {
          out[i + 1] = 1;
          changed = true;
        } else if (b && c && !a && !d) {
          out[i] = 1;
          changed = true;
        }
      }
    }
  }
  return out;
}

/**
 * Every boundary of the pixels where `inside(x, y)` holds, as closed rings
 * along pixel edges with the region on the left of travel. Assumes no saddles
 * (see `removeSaddles`), so each vertex has one outgoing edge.
 */
function traceBoundaries(
  inside: (x: number, y: number) => boolean,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Ring[] {
  const stride = x1 - x0 + 2;
  const key = (x: number, y: number) => (y - y0) * stride + (x - x0);
  // The outgoing edge per vertex, as a direction: 0 E, 1 S, 2 W, 3 N.
  const next = new Map<number, number>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) next.set(key(x + 1, y), 2);
      if (!inside(x, y + 1)) next.set(key(x, y + 1), 0);
      if (!inside(x - 1, y)) next.set(key(x, y), 1);
      if (!inside(x + 1, y)) next.set(key(x + 1, y + 1), 3);
    }
  }

  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const rings: Ring[] = [];
  for (const startKey of next.keys()) {
    let dir = next.get(startKey);
    if (dir === undefined) continue;
    let x = (startKey % stride) + x0;
    let y = Math.floor(startKey / stride) + y0;
    const ring: Ring = [];
    for (let k = startKey; dir !== undefined; dir = next.get(k)) {
      next.delete(k);
      ring.push([x, y]);
      x += DX[dir];
      y += DY[dir];
      k = key(x, y);
    }
    rings.push(dropCollinear(ring));
  }
  return rings;
}

function dropCollinear(ring: Ring): Ring {
  return ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length];
    const b = ring[(i + 1) % ring.length];
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
}

function perpendicularDistance(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length;
}

function douglasPeucker(points: Ring, tolerance: number): Ring {
  if (points.length < 3) return points;
  let index = 0;
  let max = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(points[i], points[0], points[last]);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [points[0], points[last]];
  const left = douglasPeucker(points.slice(0, index + 1), tolerance);
  const right = douglasPeucker(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** Douglas-Peucker on a closed ring, split at its two most distant vertices so
 *  the result does not depend on where tracing happened to start. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4 || tolerance <= 0) return ring;
  let far = 0;
  let best = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const first = douglasPeucker(ring.slice(0, far + 1), tolerance);
  const second = douglasPeucker([...ring.slice(far), ring[0]], tolerance);
  const simplified = [...first.slice(0, -1), ...second.slice(0, -1)];
  return simplified.length >= 3 ? simplified : ring;
}

const close = (ring: Ring): Ring => [...ring, ring[0]];

/** Polygons for every component of `mask` that survives `minArea`, largest first. */
export function maskToPolygons(
  mask: Uint8Array,
  width: number,
  height: number,
  { minArea = 16, minHoleArea = 16, tolerance = 1 }: TraceOptions = {}
): PixelPolygon[] {
  const { labels, sizes } = labelComponents(removeSaddles(mask, width, height), width, height);
  const bounds = sizes.map(() => [Infinity, Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < labels.length; i++) {
    const b = bounds[labels[i]];
    if (!labels[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  }

  const polygons: Array<{ size: number; polygon: PixelPolygon }> = [];
  for (let label = 1; label < sizes.length; label++) {
    if (sizes[label] < minArea) continue;
    const [bx0, by0, bx1, by1] = bounds[label];
    const inside = (x: number, y: number) =>
      x >= bx0 && x <= bx1 && y >= by0 && y <= by1 && labels[y * width + x] === label;
    const rings = traceBoundaries(inside, bx0, by0, bx1, by1)
      .map((ring) => ({ ring, area: ringArea(ring) }))
      .filter(({ ring }) => ring.length >= 3);
    const outer = rings.reduce((a, b) => (b.area < a.area ? b : a));
    const holes = rings.filter((r) => r !== outer && r.area >= minHoleArea);
    const polygon = [outer, ...holes]
      .map(({ ring }) => simplifyRing(ring, tolerance))
      .filter((ring) => ring.length >= 3)
      .map(close);
    if (polygon.length && polygon[0].length >= 4) polygons.push({ size: sizes[label], polygon });
  }
  return polygons.sort((a, b) => b.size - a.size).map((p) => p.polygon);
}
