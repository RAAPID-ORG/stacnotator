import { useLayoutStore as useGlobalLayoutStore } from '~/shared/stores/layout.store';
import { crossOriginForTile } from '~/shared/map/tileLoading';
import type { Bbox, LonLat, RasterLayerSpec } from '~/shared/map/types';
import {
  bboxToExtent,
  chooseZoom,
  fetchMosaic,
  growToSide,
  metresPerPixelAt,
  padExtent,
  pixelToLonLat,
  planMosaic,
  type Extent,
} from '~/shared/segmentation/mosaic';
import { splitPrompt, type PixelBox } from '~/shared/segmentation/sam';
import { growRegion, growToStop } from '~/shared/segmentation/regionGrower';
import { onSegmenterEvent, segmentBox, segmentText } from '~/shared/segmentation/segmenter';
import type { PixelPolygon } from '~/shared/segmentation/contours';
import { extendedLabels, usesWand, type ExtendedLabel } from './campaign/annotation';
import { mainCamera } from './map/camera';
import { mainRaster } from './map/compose';
import { campaignState } from './stores/campaign';
import { useImageryStore } from './stores/imagery';
import { isWandBusy, useWandStore, type Proposal } from './stores/wand';
import { useWorkStore } from './stores/work';

/** The models resize to about 1024px, so a bigger image only costs tiles. */
const MAX_IMAGE_SIDE = 1536;
/** Context around a single-object box. A tight crop blown up to the model's
 *  1024px reads as a blur and the outline bleeds into the yard; with a few
 *  hundred native pixels around it the edges hold. */
const OBJECT_PADDING = 0.2;
const OBJECT_MIN_SIDE_PX = 384;

const alert = (message: string, kind: 'error' | 'success') =>
  useGlobalLayoutStore.getState().showAlert(message, kind);

/** Whether the label's prompt decides what a box finds: the label has one,
 *  and the user has not asked for just the object in the box. */
export function findsAll(label: ExtendedLabel | undefined): boolean {
  return !!label?.segment_prompt && useWandStore.getState().mode === 'all';
}

let listening = false;
function listenToSegmenter() {
  if (listening) return;
  listening = true;
  onSegmenterEvent((event) => {
    const wand = useWandStore.getState();
    if (event.kind === 'ready') {
      wand.setBackend(event.backend);
      if (wand.status.phase === 'downloading') wand.setStatus({ phase: 'segmenting' });
    } else if (event.loaded < event.total) {
      wand.setStatus({ phase: 'downloading', ...event });
    } else if (wand.status.phase === 'downloading') wand.setStatus({ phase: 'segmenting' });
  });
}

function pixelBox(area: Extent, image: Extent, width: number, height: number): PixelBox {
  const sx = width / (image[2] - image[0]);
  const sy = height / (image[3] - image[1]);
  return [
    (area[0] - image[0]) * sx,
    (image[3] - area[3]) * sy,
    (area[2] - image[0]) * sx,
    (image[3] - area[1]) * sy,
  ];
}

function toGeometry(
  polygon: PixelPolygon,
  toLonLat: (x: number, y: number) => [number, number]
): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: polygon.map((ring) => ring.map(([x, y]) => toLonLat(x, y))),
  };
}

let proposalSeq = 0;

/** The label a wand gesture outlines for and the raster it reads, or null
 *  (and the user told why) when there is nothing to work with. */
function wandTarget(): { labelId: number; label: ExtendedLabel; raster: RasterLayerSpec } | null {
  const labelId = useWorkStore.getState().selectedLabelId;
  const label = extendedLabels(campaignState().campaign).find((l) => l.id === labelId);
  if (labelId === null || !label || !usesWand(label)) {
    alert('Pick a label with the magic wand enabled first.', 'error');
    return null;
  }
  const raster = mainRaster(campaignState().catalog, useImageryStore.getState());
  if (!raster) {
    alert('There is no imagery on the map to segment.', 'error');
    return null;
  }
  return { labelId, label, raster };
}

const crossOriginOf = (raster: RasterLayerSpec) =>
  raster.auth === 'cookie' ? 'use-credentials' : crossOriginForTile(raster.url);

const nativeZoomOf = (raster: RasterLayerSpec) =>
  raster.maxZoom ?? Math.ceil(mainCamera.getState().zoom);

/**
 * A box drawn with the wand. The visible imagery under it is fetched at the
 * source's native resolution (or as close as the image budget allows), handed
 * to the model, and what comes back is added to the proposals.
 */
export async function segmentArea(bbox: Bbox): Promise<void> {
  const wand = useWandStore.getState();
  if (isWandBusy(wand.status)) return;
  const target = wandTarget();
  if (!target) return;
  const { labelId, label, raster } = target;

  listenToSegmenter();
  wand.begin(bbox);
  const all = findsAll(label);
  const area = bboxToExtent(bbox);
  const nativeZoom = nativeZoomOf(raster);
  const extent = all
    ? area
    : growToSide(
        padExtent(area, OBJECT_PADDING),
        OBJECT_MIN_SIDE_PX * metresPerPixelAt(nativeZoom)
      );
  const plan = planMosaic(extent, chooseZoom(extent, nativeZoom, MAX_IMAGE_SIDE));
  const crossOrigin = crossOriginOf(raster);

  try {
    const mosaic = await fetchMosaic(raster.url, plan, crossOrigin);
    useWandStore.getState().setStatus({ phase: 'segmenting' });
    const { width, height } = mosaic.image;
    const result = all
      ? await segmentText(mosaic.image, splitPrompt(label.segment_prompt!))
      : await segmentBox(mosaic.image, pixelBox(area, mosaic.extent, width, height));
    const toLonLat = pixelToLonLat(mosaic.extent, width, height);
    const proposals: Proposal[] = result.objects.map((object) => ({
      id: `wand-${++proposalSeq}`,
      labelId,
      geometry: toGeometry(object.polygon, toLonLat),
      score: object.score,
      accepted: true,
    }));
    useWandStore.getState().finish(proposals, {
      found: proposals.length,
      millis: result.millis,
      metresPerPixel: mosaic.metresPerPixel,
    });
    if (proposals.length === 0) alert('Nothing found in that box.', 'error');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useWandStore.getState().fail(message);
    alert(`Magic wand failed: ${message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// The model-free wand: a click grows a region to the edges around it
// ---------------------------------------------------------------------------

/** Window grown in, in native pixels a side: a 10 m field of several km, a
 *  roof with its whole yard at 0.5 m. */
const GROW_WINDOW_PX = 768;
/** Dates whose edges are averaged in when growing across dates. */
const MAX_DATES = 4;

/** Where the last grow's pixels sit on the ground, for reshaping it. */
let grown: { toLonLat: (x: number, y: number) => [number, number] } | null = null;

/** The same place on other dates of the visible source: the cover slice of
 *  up to MAX_DATES - 1 other collections, spread over the source's span. */
function otherDates(): RasterLayerSpec[] {
  const { catalog } = campaignState();
  const imagery = useImageryStore.getState();
  if (imagery.showBasemap || !imagery.address) return [];
  const address = imagery.address;
  const collections = (catalog.sources.get(address.sourceId)?.collections ?? []).filter(
    (c) => c.id !== address.collectionId
  );
  const wanted = Math.min(MAX_DATES - 1, collections.length);
  const picked = Array.from(
    { length: wanted },
    (_, i) => collections[Math.floor(((i + 0.5) * collections.length) / wanted)]
  );
  return picked.flatMap((collection) => {
    const at = {
      ...address,
      collectionId: collection.id,
      sliceIndex: collection.cover_slice_index,
    };
    const layer = mainRaster(catalog, { ...imagery, address: at });
    return layer ? [layer] : [];
  });
}

/** Whether growing across dates is on offer: the visible imagery is a
 *  source with more than one collection. */
export function canGrowAcrossDates(): boolean {
  const { catalog } = campaignState();
  const { showBasemap, address } = useImageryStore.getState();
  if (showBasemap || !address) return false;
  return (catalog.sources.get(address.sourceId)?.collections.length ?? 0) > 1;
}

/**
 * A click with the wand: the region around it is grown out to the edges that
 * enclose it - no model, so nothing to download and an answer in a fraction
 * of a second. The outline becomes a proposal; grow and shrink then step it
 * through the other places its flood could stop.
 */
export async function growAt(at: LonLat): Promise<void> {
  if (isWandBusy(useWandStore.getState().status)) return;
  const target = wandTarget();
  if (!target) return;
  const { labelId, raster } = target;

  const nativeZoom = nativeZoomOf(raster);
  const [cx, cy] = bboxToExtent([at[0], at[1], at[0], at[1]]);
  const half = (GROW_WINDOW_PX * metresPerPixelAt(nativeZoom)) / 2;
  const extent: Extent = [cx - half, cy - half, cx + half, cy + half];
  const plan = planMosaic(extent, chooseZoom(extent, nativeZoom, MAX_IMAGE_SIDE));
  const wand = useWandStore.getState();
  wand.begin([at[0], at[1], at[0], at[1]]);

  try {
    const dates = wand.multiDate && canGrowAcrossDates() ? otherDates() : [];
    const [current, ...others] = await Promise.allSettled([
      fetchMosaic(raster.url, plan, crossOriginOf(raster)),
      ...dates.map((layer) => fetchMosaic(layer.url, plan, crossOriginOf(layer))),
    ]);
    if (current.status === 'rejected') throw current.reason;
    const mosaic = current.value;
    const { width, height } = mosaic.image;
    // A date that came back at another size (a source serving 512px tiles)
    // cannot be compared pixel for pixel; it is left out rather than resampled.
    const extra = others.flatMap((r) =>
      r.status === 'fulfilled' && r.value.image.width === width && r.value.image.height === height
        ? [r.value.image]
        : []
    );
    useWandStore.getState().setStatus({ phase: 'segmenting' });
    const seed: [number, number] = [
      Math.round(((cx - mosaic.extent[0]) / (mosaic.extent[2] - mosaic.extent[0])) * width),
      Math.round(((mosaic.extent[3] - cy) / (mosaic.extent[3] - mosaic.extent[1])) * height),
    ];
    const result = await growRegion([mosaic.image, ...extra], seed);
    const toLonLat = pixelToLonLat(mosaic.extent, width, height);
    grown = { toLonLat };
    const proposals: Proposal[] = result.polygon
      ? [
          {
            id: `wand-${++proposalSeq}`,
            labelId,
            geometry: toGeometry(result.polygon, toLonLat),
            score: 1,
            accepted: true,
          },
        ]
      : [];
    const store = useWandStore.getState();
    store.finish(proposals, {
      found: proposals.length,
      millis: result.millis,
      metresPerPixel: mosaic.metresPerPixel,
      dates: 1 + extra.length,
    });
    store.setGrowth(
      proposals.length
        ? { proposalId: proposals[0].id, index: result.index, stops: result.stops }
        : null
    );
    if (!result.polygon) alert('Nothing to outline there.', 'error');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useWandStore.getState().fail(message);
    alert(`Magic wand failed: ${message}`, 'error');
  }
}

/** Grow (+1) or shrink (-1) the last click-grown outline to its next stop. */
export async function stepGrowth(delta: 1 | -1): Promise<void> {
  const { growth, proposals } = useWandStore.getState();
  if (!growth || !grown || !proposals.some((p) => p.id === growth.proposalId)) return;
  const index = Math.max(0, Math.min(growth.stops - 1, growth.index + delta));
  if (index === growth.index) return;
  const { toLonLat } = grown;
  const result = await growToStop(index);
  const store = useWandStore.getState();
  if (store.growth?.proposalId !== growth.proposalId || !result.polygon) return;
  store.reshape(growth.proposalId, toGeometry(result.polygon, toLonLat));
  store.setGrowth({ ...growth, index: result.index });
}
