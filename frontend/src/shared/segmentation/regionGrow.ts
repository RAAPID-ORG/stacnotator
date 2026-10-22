/**
 * The model-free wand: grow a region from a clicked pixel until it meets an
 * edge, the way field boundaries are drawn classically - edge strength on a
 * texture-suppressed image, flooded outward from a seed as in marker-based
 * watershed, optionally with edges averaged over several dates.
 *
 * One flood records, for every pixel, the weakest edge it can be reached
 * across (minimax path). Any tolerance is then a threshold on that map, so
 * growing or shrinking the result never floods again.
 */

/** Flood levels are edge strengths quantised at 1/8 ΔE (CIE76 per pixel). */
export const LEVELS_PER_DELTA_E = 8;
/** Unreachable: across a colour wall, or where no tile arrived. */
export const WALL = 255;
/** A pixel this far in colour from the click never joins, whatever the
 *  tolerance - the floor under a flood that found a gap in an edge. */
const MAX_COLOUR_DISTANCE = 20;

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t) / 116 + 16 / 116);

/** RGBA -> interleaved CIELAB (D65). Transparent pixels - tiles that did not
 *  arrive - come out as NaN. */
export function rgbaToLab(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const n = width * height;
  const lab = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] < 128) {
      lab.fill(NaN, i * 3, i * 3 + 3);
      continue;
    }
    const r = SRGB_TO_LINEAR[rgba[i * 4]];
    const g = SRGB_TO_LINEAR[rgba[i * 4 + 1]];
    const b = SRGB_TO_LINEAR[rgba[i * 4 + 2]];
    const fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    lab[i * 3] = 116 * fy - 16;
    lab[i * 3 + 1] = 500 * (fx - fy);
    lab[i * 3 + 2] = 200 * (fy - fz);
  }
  return lab;
}

/** Median of five without sorting them all: order two pairs, drop the
 *  lowest of the four (it is below three others), bring in the fifth, and
 *  repeat once - what is left between the two pair tops is the median. */
export function median5(a: number, b: number, c: number, d: number, e: number): number {
  let t: number;
  if (a > b) {
    t = a;
    a = b;
    b = t;
  }
  if (c > d) {
    t = c;
    c = d;
    d = t;
  }
  if (a > c) {
    c = a;
    t = b;
    b = d;
    d = t;
  }
  a = e;
  if (a > b) {
    t = a;
    a = b;
    b = t;
  }
  if (a > c) {
    c = a;
    b = d;
  }
  return b < c ? b : c;
}

/**
 * 5x5 median per channel, done separably (rows, then columns) - the usual
 * fast stand-in for the full window. It flattens texture inside a field (crop
 * rows, pivot rings, blotches) while keeping the step at its edge, which a
 * blur of the same size would smear. Missing pixels stay missing, and do not
 * count as neighbours.
 */
export function median(lab: Float32Array, width: number, height: number): Float32Array {
  const rows = medianPass(lab, width, height, 3, 3 * width);
  return medianPass(rows, height, width, 3 * width, 3);
}

/** One 5-tap median along lines of `length` samples `step` apart, lines
 *  `lineStep` apart. */
function medianPass(
  src: Float32Array,
  length: number,
  lines: number,
  step: number,
  lineStep: number
): Float32Array {
  const dst = new Float32Array(src.length);
  const last = length - 1;
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    for (let k = 0; k < length; k++) {
      const km2 = base + (k > 1 ? k - 2 : 0) * step;
      const km1 = base + (k > 0 ? k - 1 : 0) * step;
      const k0 = base + k * step;
      const kp1 = base + (k < last ? k + 1 : last) * step;
      const kp2 = base + (k < last - 1 ? k + 2 : last) * step;
      for (let c = 0; c < 3; c++) {
        const v = src[k0 + c];
        if (v !== v) {
          dst[k0 + c] = NaN;
          continue;
        }
        let a = src[km2 + c];
        let b = src[km1 + c];
        let d = src[kp1 + c];
        let e = src[kp2 + c];
        if (a !== a) a = v;
        if (b !== b) b = v;
        if (d !== d) d = v;
        if (e !== e) e = v;
        dst[k0 + c] = median5(a, b, v, d, e);
      }
    }
  }
  return dst;
}

/**
 * Sobel gradient magnitude over the three Lab channels, in ΔE per pixel, then
 * a 3x3 maximum so a one-pixel road between two fields is a closed wall
 * rather than a dotted line.
 */
export function edgeStrength(lab: Float32Array, width: number, height: number): Float32Array {
  const value = (i: number) => (lab[i] === lab[i] ? lab[i] : 0);
  const magnitude = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const up = (y > 0 ? y - 1 : 0) * width;
    const row = y * width;
    const down = (y < height - 1 ? y + 1 : y) * width;
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? x - 1 : 0;
      const right = x < width - 1 ? x + 1 : x;
      let sum = 0;
      for (let c = 0; c < 3; c++) {
        const nw = value((up + left) * 3 + c);
        const n = value((up + x) * 3 + c);
        const ne = value((up + right) * 3 + c);
        const w = value((row + left) * 3 + c);
        const e = value((row + right) * 3 + c);
        const sw = value((down + left) * 3 + c);
        const s = value((down + x) * 3 + c);
        const se = value((down + right) * 3 + c);
        const gx = (ne + 2 * e + se - nw - 2 * w - sw) / 8;
        const gy = (sw + 2 * s + se - nw - 2 * n - ne) / 8;
        sum += gx * gx + gy * gy;
      }
      magnitude[row + x] = Math.sqrt(sum);
    }
  }
  return max3x3(magnitude, width, height);
}

/** Separable 3x3 maximum. */
function max3x3(values: Float32Array, width: number, height: number): Float32Array {
  const rows = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let m = values[i];
      if (x > 0 && values[i - 1] > m) m = values[i - 1];
      if (x < width - 1 && values[i + 1] > m) m = values[i + 1];
      rows[i] = m;
    }
  }
  const out = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let m = rows[i];
      if (y > 0 && rows[i - width] > m) m = rows[i - width];
      if (y < height - 1 && rows[i + width] > m) m = rows[i + width];
      out[i] = m;
    }
  }
  return out;
}

/** Edges averaged over dates: a boundary between two crops shows on most
 *  of them, while one date's cloud edge or ploughing pattern is diluted. */
export function meanEdges(dates: Float32Array[]): Float32Array {
  const out = new Float32Array(dates[0].length);
  for (const edges of dates) for (let i = 0; i < out.length; i++) out[i] += edges[i];
  for (let i = 0; i < out.length; i++) out[i] /= dates.length;
  return out;
}

/** The colour the click landed on: the mean of the 5x5 around it, so one
 *  odd pixel does not decide what the field looks like. */
function seedColour(lab: Float32Array, width: number, height: number, seed: number): number[] {
  const sx = seed % width;
  const sy = (seed - sx) / width;
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = Math.max(0, sy - 2); y <= Math.min(height - 1, sy + 2); y++) {
    for (let x = Math.max(0, sx - 2); x <= Math.min(width - 1, sx + 2); x++) {
      const i = (y * width + x) * 3;
      if (lab[i] !== lab[i]) continue;
      for (let c = 0; c < 3; c++) sum[c] += lab[i + c];
      count++;
    }
  }
  return sum.map((s) => s / Math.max(1, count));
}

/** Edge strengths as flood levels, with everything too far in colour from
 *  the click - or missing - walled off. */
export function floodBarrier(
  edges: Float32Array,
  lab: Float32Array,
  width: number,
  height: number,
  seed: number
): Uint8Array {
  const ref = seedColour(lab, width, height, seed);
  const levels = new Uint8Array(edges.length);
  for (let i = 0; i < edges.length; i++) {
    const dl = lab[i * 3] - ref[0];
    const da = lab[i * 3 + 1] - ref[1];
    const db = lab[i * 3 + 2] - ref[2];
    const far = !(dl * dl + da * da + db * db <= MAX_COLOUR_DISTANCE ** 2);
    levels[i] = far ? WALL : Math.min(WALL - 1, Math.round(edges[i] * LEVELS_PER_DELTA_E));
  }
  return levels;
}

/**
 * For every pixel, the lowest level at which it joins the seed's region: the
 * strongest edge on the gentlest path from the seed (a bucket-queue minimax
 * flood). The seed itself is always in. WALL for pixels never reached.
 */
export function flood(
  barrier: Uint8Array,
  width: number,
  height: number,
  seed: number
): Uint8Array {
  const reached = new Uint8Array(barrier.length).fill(WALL);
  const buckets: number[][] = Array.from({ length: WALL }, () => []);
  reached[seed] = 0;
  buckets[0].push(seed);
  for (let level = 0; level < WALL; level++) {
    const bucket = buckets[level];
    while (bucket.length) {
      const i = bucket.pop()!;
      if (reached[i] !== level) continue;
      const x = i % width;
      const neighbours = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width];
      for (const j of neighbours) {
        if (j < 0 || j >= barrier.length || barrier[j] === WALL) continue;
        const next = Math.max(level, barrier[j]);
        if (next < reached[j]) {
          reached[j] = next;
          buckets[next].push(j);
        }
      }
    }
  }
  return reached;
}

export interface Stops {
  /** The levels grow and shrink step through, smallest first: the level
   *  before each jump in size, and in between a step for roughly every
   *  quarter more area, so the right size is never far. */
  levels: number[];
  /** Index into `levels` of the one to show first. */
  preferred: number;
}

/**
 * Where to stop. Grown level by level, a field's area plateaus once it is
 * filled and jumps when the flood spills across an edge into the next one.
 * The first level shown is the one before the first jump that looks like a
 * spill - the area at least triples and the new pixels differ in colour -
 * or, failing that, before the biggest jump. Textured fields also fill
 * gradually, which is what the in-between steps are for.
 */
export function stopLevels(
  reached: Uint8Array,
  lab: Float32Array,
  { minArea = 64, maxShare = 0.6, step = 2, growth = 1.25 } = {}
): Stops {
  const count = new Float64Array(WALL);
  const sums = new Float64Array(WALL * 3);
  for (let i = 0; i < reached.length; i++) {
    const level = reached[i];
    if (level === WALL || lab[i * 3] !== lab[i * 3]) continue;
    count[level]++;
    for (let c = 0; c < 3; c++) sums[level * 3 + c] += lab[i * 3 + c];
  }
  for (let level = 1; level < WALL; level++) {
    count[level] += count[level - 1];
    for (let c = 0; c < 3; c++) sums[level * 3 + c] += sums[(level - 1) * 3 + c];
  }
  const maxArea = reached.length * maxShare;
  const newColour = (from: number, to: number) => {
    const added = count[to] - count[from];
    let d = 0;
    for (let c = 0; c < 3; c++) {
      const region = sums[from * 3 + c] / count[from];
      const fresh = (sums[to * 3 + c] - sums[from * 3 + c]) / added;
      d += (region - fresh) ** 2;
    }
    return Math.sqrt(d);
  };

  const levels: number[] = [];
  let lastArea = 0;
  let spill = -1;
  let biggest = -1;
  let biggestRatio = 1.5;
  for (let level = 0; level + step < WALL; level++) {
    const area = count[level];
    if (area < minArea) continue;
    if (area > maxArea) break;
    const ratio = count[level + step] / area;
    const jumps = ratio >= 1.5;
    if (!jumps && area < lastArea * growth) continue;
    if (levels.at(-1) !== level && area > lastArea) {
      levels.push(level);
      lastArea = area;
    }
    if (!jumps) continue;
    if (spill < 0 && ratio >= 3 && newColour(level, level + step) >= 5) spill = level;
    if (ratio > biggestRatio) {
      biggestRatio = ratio;
      biggest = level;
    }
  }
  if (levels.length === 0) {
    // The region covers most of the window before its area means anything:
    // edges too faint to choose from. Start moderate; grow and shrink move.
    return { levels: [2 * LEVELS_PER_DELTA_E], preferred: 0 };
  }
  const first = spill >= 0 ? spill : biggest;
  const preferred = first < 0 ? levels.length - 1 : levels.lastIndexOf(first);
  return { levels, preferred: Math.max(0, preferred) };
}

/**
 * The region at `level` as a mask: one opening pass to cut the one-pixel
 * necks a flood leaks through, then only the part still joined to the seed.
 */
export function regionAt(
  reached: Uint8Array,
  width: number,
  height: number,
  level: number,
  seed: number
): Uint8Array {
  const n = reached.length;
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) inside[i] = reached[i] <= level ? 1 : 0;
  const opened = dilate(erode(inside, width, height), width, height);
  const source = opened[seed] ? opened : inside;
  const region = fill(source, width, [seed]);
  // A field is solid: the patches the flood skipped inside it are in it.
  const border: number[] = [];
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) border.push(y * width, y * width + width - 1);
  const outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) outside[i] = region[i] ? 0 : 1;
  const reachable = fill(
    outside,
    width,
    border.filter((i) => outside[i])
  );
  for (let i = 0; i < n; i++) region[i] = reachable[i] ? 0 : 1;
  return region;
}

/** The 4-connected part of `allowed` reachable from `starts`. */
function fill(allowed: Uint8Array, width: number, starts: number[]): Uint8Array {
  const n = allowed.length;
  const out = new Uint8Array(n);
  const stack: number[] = [];
  for (const s of starts) {
    if (!out[s]) {
      out[s] = 1;
      stack.push(s);
    }
  }
  const visit = (j: number) => {
    if (allowed[j] && !out[j]) {
      out[j] = 1;
      stack.push(j);
    }
  };
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i + width < n) visit(i + width);
  }
  return out;
}

function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  return morph(mask, width, height, 5);
}

function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  return morph(mask, width, height, 1);
}

/** Cross-shaped (4-neighbour) morphology: a pixel is set when at least
 *  `needed` of itself and its four neighbours are - 5 erodes, 1 dilates. */
function morph(mask: Uint8Array, width: number, height: number, needed: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const set =
        mask[i] +
        (x > 0 ? mask[i - 1] : 0) +
        (x < width - 1 ? mask[i + 1] : 0) +
        (y > 0 ? mask[i - width] : 0) +
        (y < height - 1 ? mask[i + width] : 0);
      out[i] = set >= needed ? 1 : 0;
    }
  }
  return out;
}
