import type { PixelPolygon } from './contours';
import type { GrowRequest, GrowResponse } from './protocol';

export interface Growth {
  polygon: PixelPolygon | null;
  index: number;
  stops: number;
  millis: number;
}

type Job =
  | { kind: 'grow'; images: ImageData[]; seed: [number, number] }
  | { kind: 'level'; index: number };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (g: Growth) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./grow.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<GrowResponse>) => {
    const message = event.data;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.kind === 'error') request?.reject(new Error(message.message));
    else request?.resolve(message);
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'The region grower failed');
    pending.forEach((p) => p.reject(error));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function send(job: Job): Promise<Growth> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    if (job.kind === 'level') {
      getWorker().postMessage({ id, ...job } satisfies GrowRequest);
      return;
    }
    const images = job.images.map(({ data, width, height }) => ({ data, width, height }));
    getWorker().postMessage(
      { id, kind: 'grow', images, seed: job.seed } satisfies GrowRequest,
      images.map((i) => i.data.buffer)
    );
  });
}

/** Outline the region around `seed`, from the first image's colours and the
 *  edges of all of them. */
export const growRegion = (images: ImageData[], seed: [number, number]) =>
  send({ kind: 'grow', images, seed });

/** The last grow's outline at another of its stops. */
export const growToStop = (index: number) => send({ kind: 'level', index });
