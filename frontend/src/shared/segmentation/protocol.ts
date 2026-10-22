import type { PixelPolygon } from './contours';
import type { SegmentationModelId } from './models';
import type { PixelBox } from './sam';

export interface RasterImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type SegmentJob =
  | { kind: 'box'; image: RasterImage; box: PixelBox }
  | { kind: 'text'; image: RasterImage; prompts: string[]; threshold: number };

export type SegmentRequest = SegmentJob & { id: number };

export interface SegmentedObject {
  polygon: PixelPolygon;
  score: number;
}

export type Backend = 'webgpu' | 'wasm';

export type WorkerMessage =
  | { kind: 'result'; id: number; objects: SegmentedObject[]; millis: number }
  | { kind: 'error'; id: number; message: string }
  | { kind: 'progress'; model: SegmentationModelId; loaded: number; total: number }
  | { kind: 'ready'; model: SegmentationModelId; backend: Backend };

export interface WorkerInit {
  kind: 'init';
  modelsUrl: string;
}

/** The model-free wand: grow from a pixel (`seed` is [x, y]); `images` is
 *  the date on screen first, then any others whose edges are averaged in.
 *  `level` re-thresholds the last grow at another of its stops. */
export type GrowRequest =
  | { id: number; kind: 'grow'; images: RasterImage[]; seed: [number, number] }
  | { id: number; kind: 'level'; index: number };

export type GrowResponse =
  | {
      id: number;
      kind: 'grown';
      polygon: PixelPolygon | null;
      /** Which of the `stops` levels the outline is at. */
      index: number;
      stops: number;
      millis: number;
    }
  | { id: number; kind: 'error'; message: string; millis: number };
