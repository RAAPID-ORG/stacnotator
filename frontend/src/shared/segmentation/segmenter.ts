import { segmentationModelsUrl, type SegmentationModelId } from './models';
import type {
  Backend,
  SegmentedObject,
  SegmentJob,
  SegmentRequest,
  WorkerMessage,
} from './protocol';
import type { PixelBox } from './sam';

export type SegmenterEvent =
  | { kind: 'progress'; model: SegmentationModelId; loaded: number; total: number }
  | { kind: 'ready'; model: SegmentationModelId; backend: Backend };

export interface SegmentResult {
  objects: SegmentedObject[];
  millis: number;
}

type Pending = { resolve: (r: SegmentResult) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const listeners = new Set<(event: SegmenterEvent) => void>();

/** The worker is started on first use: until someone segments, the app pays
 *  for none of this. */
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });
  worker.postMessage({ kind: 'init', modelsUrl: segmentationModelsUrl() });
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.kind === 'result' || message.kind === 'error') {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.kind === 'result') {
        request?.resolve({ objects: message.objects, millis: message.millis });
      } else request?.reject(new Error(message.message));
      return;
    }
    listeners.forEach((listener) => listener(message));
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'The segmentation worker failed');
    pending.forEach((p) => p.reject(error));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function send(job: SegmentJob): Promise<SegmentResult> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const message: SegmentRequest = { ...job, id };
    getWorker().postMessage(message, [message.image.data.buffer]);
  });
}

export function onSegmenterEvent(listener: (event: SegmenterEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The single object inside `box`, outlined. */
export function segmentBox(image: ImageData, box: PixelBox): Promise<SegmentResult> {
  const { data, width, height } = image;
  return send({ kind: 'box', image: { data, width, height }, box });
}

/** Every instance of any of `prompts` anywhere in the image. */
export function segmentText(
  image: ImageData,
  prompts: string[],
  threshold = 0.5
): Promise<SegmentResult> {
  const { data, width, height } = image;
  return send({ kind: 'text', image: { data, width, height }, prompts, threshold });
}
