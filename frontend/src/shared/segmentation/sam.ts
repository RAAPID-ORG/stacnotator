/**
 * Tensor layouts for the two segmentation models, as plain array maths so
 * they can be checked without a model or a GPU.
 */

/** Pixel box in image coordinates: [x0, y0, x1, y1]. */
export type PixelBox = [number, number, number, number];

export const SAM2_SIZE = 1024;
export const SAM3_SIZE = 1008;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** SAM 2 input: RGBA at SAM2_SIZE square -> ImageNet-normalised float CHW. */
export function sam2Pixels(rgba: Uint8ClampedArray, size = SAM2_SIZE): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  return out;
}

/** SAM 3 input: RGBA at SAM3_SIZE square -> uint8 CHW (the export normalises itself). */
export function sam3Pixels(rgba: Uint8ClampedArray, size = SAM3_SIZE): Uint8Array {
  const plane = size * size;
  const out = new Uint8Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = rgba[i * 4 + c];
  }
  return out;
}

/**
 * A box as SAM 2's two corner points (labels 2 and 3), in the coordinates of
 * the square the image was stretched to - SAM 2 resizes without keeping the
 * aspect ratio.
 */
export function sam2BoxPrompt(
  box: PixelBox,
  width: number,
  height: number,
  size = SAM2_SIZE
): { coords: Float32Array; labels: Float32Array } {
  const sx = size / width;
  const sy = size / height;
  return {
    coords: Float32Array.of(box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy),
    labels: Float32Array.of(2, 3),
  };
}

/**
 * Bilinear upsampling of a low-resolution logit map to the image's size,
 * thresholded at 0. Sampling the logits rather than a thresholded mask is
 * what keeps the outline smooth instead of blocky.
 */
export function upsampleLogits(
  logits: Float32Array,
  lw: number,
  lh: number,
  width: number,
  height: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const sx = lw / width;
  const sy = lh / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(lh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(lh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(lw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(lw - 1, x0 + 1);
      const tx = fx - x0;
      const top = logits[y0 * lw + x0] * (1 - tx) + logits[y0 * lw + x1] * tx;
      const bottom = logits[y1 * lw + x0] * (1 - tx) + logits[y1 * lw + x1] * tx;
      mask[y * width + x] = top * (1 - ty) + bottom * ty > 0 ? 1 : 0;
    }
  }
  return mask;
}

/** The comma-separated alternatives of a label's prompt, deduplicated. */
export function splitPrompt(prompt: string): string[] {
  return [
    ...new Set(
      prompt
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

/** Intersection over union of two equally sized masks. */
export function maskIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) union++;
  }
  return union ? inter / union : 0;
}

/**
 * Greedy non-maximum suppression over masks: a prompt with alternatives
 * ("building, house") finds the same roof once per alternative, and it should
 * be proposed once.
 */
export function suppressDuplicates<T extends { mask: Uint8Array; score: number }>(
  detections: T[],
  threshold = 0.5
): T[] {
  const kept: T[] = [];
  for (const d of [...detections].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => maskIoU(k.mask, d.mask) < threshold)) kept.push(d);
  }
  return kept;
}
