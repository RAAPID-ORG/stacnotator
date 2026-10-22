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
