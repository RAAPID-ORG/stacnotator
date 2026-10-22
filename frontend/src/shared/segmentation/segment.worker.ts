/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { createClipTokenizer, type ClipTokenizer } from './clipTokenizer';
import { maskToPolygons } from './contours';
import { SEGMENTATION_MODELS, type ModelFile, type SegmentationModelId } from './models';
import type {
  Backend,
  RasterImage,
  SegmentedObject,
  SegmentRequest,
  WorkerInit,
  WorkerMessage,
} from './protocol';
import {
  SAM2_SIZE,
  SAM3_SIZE,
  sam2BoxPrompt,
  sam2Pixels,
  sam3Pixels,
  suppressDuplicates,
  upsampleLogits,
  type PixelBox,
} from './sam';

declare const self: DedicatedWorkerGlobalScope;

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.logLevel = 'error';

const CACHE_NAME = 'stacnotator-segmentation-v1';
const post = (message: WorkerMessage) => self.postMessage(message);

let modelsUrl = '';

// ---------------------------------------------------------------------------
// Files and sessions
// ---------------------------------------------------------------------------

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // Private windows and some embedded contexts refuse Cache Storage; the
    // model then simply downloads again next time.
    return null;
  }
}

/** Download every file of a model with one combined progress count, reading
 *  through Cache Storage so it only crosses the network once. */
async function fetchFiles(model: SegmentationModelId, names: string[]): Promise<ArrayBuffer[]> {
  const folder = `${modelsUrl}/${SEGMENTATION_MODELS[model].folder}`;
  const cache = await openCache();
  const responses = await Promise.all(
    names.map(async (name) => {
      const url = `${folder}/${name}`;
      const hit = await cache?.match(url);
      if (hit) return { url, response: hit, cached: true };
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not download ${name} (${response.status})`);
      return { url, response, cached: false };
    })
  );
  const total = responses.reduce(
    (sum, { response }) => sum + Number(response.headers.get('content-length') ?? 0),
    0
  );
  let loaded = 0;
  return Promise.all(
    responses.map(async ({ url, response, cached }) => {
      if (cached || !response.body) {
        const buffer = await response.arrayBuffer();
        loaded += buffer.byteLength;
        post({ kind: 'progress', model, loaded, total });
        return buffer;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        post({ kind: 'progress', model, loaded, total });
      }
      const blob = new Blob(chunks as BlobPart[]);
      await cache?.put(url, new Response(blob)).catch(() => undefined);
      return blob.arrayBuffer();
    })
  );
}

let backendPromise: Promise<Backend> | null = null;
function backend(): Promise<Backend> {
  backendPromise ??= (async () => {
    const { gpu } = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    const adapter = await gpu?.requestAdapter().catch(() => null);
    return adapter ? 'webgpu' : 'wasm';
  })();
  return backendPromise;
}

async function createSession(
  graph: ArrayBuffer,
  file: ModelFile,
  data: ArrayBuffer | undefined,
  outputsOnGpu: boolean
): Promise<ort.InferenceSession> {
  const options = (provider: Backend): ort.InferenceSession.SessionOptions => ({
    executionProviders: [provider],
    graphOptimizationLevel: 'all',
    externalData: file.data && data ? [{ path: file.data, data: new Uint8Array(data) }] : undefined,
    preferredOutputLocation: outputsOnGpu && provider === 'webgpu' ? 'gpu-buffer' : 'cpu',
  });
  const chosen = await backend();
  try {
    return await ort.InferenceSession.create(new Uint8Array(graph), options(chosen));
  } catch (error) {
    if (chosen === 'wasm') throw error;
    // An op the WebGPU provider cannot place is a slower answer, not no answer.
    return ort.InferenceSession.create(new Uint8Array(graph), options('wasm'));
  }
}

async function loadPair(model: SegmentationModelId, encoderOnGpu: boolean) {
  const { encoder, decoder } = SEGMENTATION_MODELS[model];
  const files = [encoder.graph, encoder.data, decoder.graph, decoder.data];
  const [eg, ed, dg, dd] = await fetchFiles(
    model,
    files.filter((f): f is string => !!f)
  ).then((buffers) => {
    const queue = [...buffers];
    return files.map((f) => (f ? queue.shift() : undefined));
  });
  const sessions = {
    encoder: await createSession(eg!, encoder, ed, encoderOnGpu),
    decoder: await createSession(dg!, decoder, dd, false),
  };
  post({ kind: 'ready', model, backend: await backend() });
  return sessions;
}

const loaded: Partial<Record<SegmentationModelId, ReturnType<typeof loadPair>>> = {};
function sessions(model: SegmentationModelId) {
  loaded[model] ??= loadPair(model, true).catch((error) => {
    delete loaded[model];
    throw error;
  });
  return loaded[model];
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

async function resized(image: RasterImage, size: number): Promise<Uint8ClampedArray> {
  const source = new ImageData(
    image.data as Uint8ClampedArray<ArrayBuffer>,
    image.width,
    image.height
  );
  const bitmap = await createImageBitmap(source, {
    resizeWidth: size,
    resizeHeight: size,
    resizeQuality: 'high',
  });
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, size, size).data;
}

function disposeAll(outputs: ort.InferenceSession.ReturnType) {
  for (const tensor of Object.values(outputs)) tensor.dispose();
}

/** Speckle under this share of the image is not an object. */
const minArea = (image: RasterImage) => Math.max(8, image.width * image.height * 0.0002);

// ---------------------------------------------------------------------------
// SAM 2.1: one object per box
// ---------------------------------------------------------------------------

async function segmentBox(image: RasterImage, box: PixelBox): Promise<SegmentedObject[]> {
  const { encoder, decoder } = await sessions('box');
  const pixels = sam2Pixels(await resized(image, SAM2_SIZE));
  const features = await encoder.run({
    image: new ort.Tensor('float32', pixels, [1, 3, SAM2_SIZE, SAM2_SIZE]),
  });
  try {
    const prompt = sam2BoxPrompt(box, image.width, image.height);
    const out = await decoder.run({
      image_embed: features.image_embed,
      high_res_feats_0: features.high_res_feats_0,
      high_res_feats_1: features.high_res_feats_1,
      point_coords: new ort.Tensor('float32', prompt.coords, [1, 2, 2]),
      point_labels: new ort.Tensor('float32', prompt.labels, [1, 2]),
      mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
      has_mask_input: new ort.Tensor('float32', Float32Array.of(0), [1]),
    });
    const scores = out.iou_predictions.data as Float32Array;
    const [, count, lh, lw] = out.masks.dims;
    let best = 0;
    for (let i = 1; i < count; i++) if (scores[i] > scores[best]) best = i;
    const logits = (out.masks.data as Float32Array).subarray(best * lh * lw, (best + 1) * lh * lw);
    const mask = upsampleLogits(logits, lw, lh, image.width, image.height);
    const [polygon] = maskToPolygons(mask, image.width, image.height, {
      minArea: minArea(image),
      minHoleArea: minArea(image),
    });
    return polygon ? [{ polygon, score: scores[best] }] : [];
  } finally {
    disposeAll(features);
  }
}

// ---------------------------------------------------------------------------
// SAM 3: every instance of a prompt
// ---------------------------------------------------------------------------

interface LanguageFeatures {
  mask: Uint8Array;
  features: Float32Array;
}

let tokenizer: Promise<ClipTokenizer> | null = null;
const languageCache = new Map<string, LanguageFeatures>();

function getTokenizer(): Promise<ClipTokenizer> {
  tokenizer ??= fetchFiles('text', [SEGMENTATION_MODELS.text.vocabulary!]).then(async ([file]) => {
    // Hosts that serve .gz with Content-Encoding hand over the text already
    // inflated, so only gunzip what still starts with the gzip magic bytes.
    const bytes = new Uint8Array(file);
    const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const text = gzipped
      ? await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
        ).text()
      : new TextDecoder().decode(bytes);
    return createClipTokenizer(text);
  });
  return tokenizer;
}

const languageKey = (prompt: string) =>
  `${modelsUrl}/${SEGMENTATION_MODELS.text.folder}/__prompts/${encodeURIComponent(prompt)}`;

/**
 * The text encoder's output for each prompt. It depends on nothing but the
 * words, so it is kept in Cache Storage and the 240 MB encoder is only
 * fetched - and then released again - for a prompt this browser has not seen.
 */
async function languageFeatures(prompts: string[]): Promise<LanguageFeatures[]> {
  const cache = await openCache();
  for (const prompt of prompts) {
    if (languageCache.has(prompt)) continue;
    const hit = await cache?.match(languageKey(prompt));
    if (!hit) continue;
    const bytes = await hit.arrayBuffer();
    languageCache.set(prompt, {
      features: new Float32Array(bytes, 0, 32 * 256),
      mask: new Uint8Array(bytes, 32 * 256 * 4, 32),
    });
  }
  const missing = prompts.filter((p) => !languageCache.has(p));
  if (missing.length) {
    const file = SEGMENTATION_MODELS.text.language!;
    const [graph, data] = await fetchFiles('text', [file.graph, file.data!]);
    const encoder = await createSession(graph, file, data, false);
    const tokens = await getTokenizer();
    try {
      for (const prompt of missing) {
        const ids = BigInt64Array.from(tokens.encode(prompt), (t) => BigInt(t));
        const out = await encoder.run({ tokens: new ort.Tensor('int64', ids, [1, 32]) });
        const entry = {
          features: (out.text_memory.data as Float32Array).slice(),
          mask: (out.text_attention_mask.data as Uint8Array).slice(),
        };
        disposeAll(out);
        languageCache.set(prompt, entry);
        const bytes = new Uint8Array(32 * 256 * 4 + 32);
        bytes.set(new Uint8Array(entry.features.buffer), 0);
        bytes.set(entry.mask, 32 * 256 * 4);
        await cache?.put(languageKey(prompt), new Response(bytes)).catch(() => undefined);
      }
    } finally {
      await encoder.release();
    }
  }
  return prompts.map((p) => languageCache.get(p)!);
}

async function segmentText(
  image: RasterImage,
  prompts: string[],
  threshold: number
): Promise<SegmentedObject[]> {
  const language = await languageFeatures(prompts);
  const { encoder, decoder } = await sessions('text');
  const pixels = sam3Pixels(await resized(image, SAM3_SIZE));
  const features = await encoder.run({
    image: new ort.Tensor('uint8', pixels, [3, SAM3_SIZE, SAM3_SIZE]),
  });
  const plane = image.width * image.height;
  const detections: Array<{ mask: Uint8Array; score: number }> = [];
  try {
    for (const { features: text, mask } of language) {
      const out = await decoder.run({
        original_height: new ort.Tensor('int64', BigInt64Array.of(BigInt(image.height)), []),
        original_width: new ort.Tensor('int64', BigInt64Array.of(BigInt(image.width)), []),
        vision_pos_enc_2: features.vision_pos_enc_2,
        backbone_fpn_0: features.backbone_fpn_0,
        backbone_fpn_1: features.backbone_fpn_1,
        backbone_fpn_2: features.backbone_fpn_2,
        language_mask: new ort.Tensor('bool', mask, [1, 32]),
        language_features: new ort.Tensor('float32', text, [32, 1, 256]),
        box_coords: new ort.Tensor('float32', new Float32Array(4), [1, 1, 4]),
        box_labels: new ort.Tensor('int64', BigInt64Array.of(1n), [1, 1]),
        // No exemplar box: the prompt alone says what to find.
        box_masks: new ort.Tensor('bool', Uint8Array.of(1), [1, 1]),
      });
      const scores = out.scores.data as Float32Array;
      const masks = out.masks.data as Uint8Array;
      scores.forEach((score, i) => {
        if (score >= threshold) {
          detections.push({ score, mask: masks.slice(i * plane, (i + 1) * plane) });
        }
      });
      disposeAll(out);
    }
  } finally {
    disposeAll(features);
  }
  const objects: SegmentedObject[] = [];
  for (const { mask, score } of suppressDuplicates(detections)) {
    const [polygon] = maskToPolygons(mask, image.width, image.height, {
      minArea: minArea(image),
      minHoleArea: minArea(image),
    });
    if (polygon) objects.push({ polygon, score });
  }
  return objects;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** One request at a time: they share one GPU, and running two at once only
 *  makes both slower. */
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (event: MessageEvent<WorkerInit | SegmentRequest>) => {
  const message = event.data;
  if (message.kind === 'init') {
    modelsUrl = message.modelsUrl;
    return;
  }
  queue = queue.then(async () => {
    const started = performance.now();
    try {
      const objects =
        message.kind === 'box'
          ? await segmentBox(message.image, message.box)
          : await segmentText(message.image, message.prompts, message.threshold);
      post({ kind: 'result', id: message.id, objects, millis: performance.now() - started });
    } catch (error) {
      post({
        kind: 'error',
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
