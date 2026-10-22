/// <reference lib="webworker" />
import { maskToPolygons, type PixelPolygon } from './contours';
import type { GrowRequest, GrowResponse } from './protocol';
import {
  edgeStrength,
  flood,
  floodBarrier,
  meanEdges,
  median,
  regionAt,
  rgbaToLab,
  stopLevels,
  type Stops,
} from './regionGrow';

declare const self: DedicatedWorkerGlobalScope;

/** The last click's flood, kept so grow and shrink only re-threshold it. */
let last: {
  reached: Uint8Array;
  width: number;
  height: number;
  seed: number;
  stops: Stops;
} | null = null;

function outline(index: number) {
  if (!last) return null;
  const { reached, width, height, seed, stops } = last;
  const mask = regionAt(reached, width, height, stops.levels[index], seed);
  const [polygon] = maskToPolygons(mask, width, height, { minArea: 1, minHoleArea: 16 });
  return polygon ?? null;
}

self.onmessage = (event: MessageEvent<GrowRequest>) => {
  const message = event.data;
  const started = performance.now();
  const reply = (
    r:
      | { kind: 'grown'; polygon: PixelPolygon | null; index: number; stops: number }
      | { kind: 'error'; message: string }
  ) =>
    self.postMessage({
      ...r,
      id: message.id,
      millis: performance.now() - started,
    } satisfies GrowResponse);
  try {
    if (message.kind === 'grow') {
      const [current, ...others] = message.images;
      const { width, height } = current;
      const lab = median(rgbaToLab(current.data, width, height), width, height);
      const dates = [
        edgeStrength(lab, width, height),
        ...others.map((image) =>
          edgeStrength(median(rgbaToLab(image.data, width, height), width, height), width, height)
        ),
      ];
      const edges = dates.length > 1 ? meanEdges(dates) : dates[0];
      const seed = message.seed[1] * width + message.seed[0];
      const reached = flood(floodBarrier(edges, lab, width, height, seed), width, height, seed);
      last = { reached, width, height, seed, stops: stopLevels(reached, lab) };
      const index = last.stops.preferred;
      reply({ kind: 'grown', polygon: outline(index), index, stops: last.stops.levels.length });
      return;
    }
    const index = Math.max(0, Math.min((last?.stops.levels.length ?? 1) - 1, message.index));
    reply({ kind: 'grown', polygon: outline(index), index, stops: last?.stops.levels.length ?? 0 });
  } catch (error) {
    reply({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
