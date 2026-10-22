import { useLayoutStore as useGlobalLayoutStore } from '~/shared/stores/layout.store';
import { crossOriginForTile } from '~/shared/map/tileLoading';
import type { Bbox } from '~/shared/map/types';
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

/**
 * A box drawn with the wand. The visible imagery under it is fetched at the
 * source's native resolution (or as close as the image budget allows), handed
 * to the model, and what comes back is added to the proposals.
 */
export async function segmentArea(bbox: Bbox): Promise<void> {
  const wand = useWandStore.getState();
  if (isWandBusy(wand.status)) return;
  const labelId = useWorkStore.getState().selectedLabelId;
  const label = extendedLabels(campaignState().campaign).find((l) => l.id === labelId);
  if (labelId === null || !usesWand(label)) {
    alert('Pick a label with the magic wand enabled first.', 'error');
    return;
  }

  const raster = mainRaster(campaignState().catalog, useImageryStore.getState());
  if (!raster) {
    alert('There is no imagery on the map to segment.', 'error');
    return;
  }

  listenToSegmenter();
  wand.begin(bbox);
  const all = findsAll(label);
  const area = bboxToExtent(bbox);
  const nativeZoom = raster.maxZoom ?? Math.ceil(mainCamera.getState().zoom);
  const extent = all
    ? area
    : growToSide(
        padExtent(area, OBJECT_PADDING),
        OBJECT_MIN_SIDE_PX * metresPerPixelAt(nativeZoom)
      );
  const plan = planMosaic(extent, chooseZoom(extent, nativeZoom, MAX_IMAGE_SIDE));
  const crossOrigin = raster.auth === 'cookie' ? 'use-credentials' : crossOriginForTile(raster.url);

  try {
    const mosaic = await fetchMosaic(raster.url, plan, crossOrigin);
    useWandStore.getState().setStatus({ phase: 'segmenting' });
    const { width, height } = mosaic.image;
    const result = all
      ? await segmentText(mosaic.image, splitPrompt(label!.segment_prompt!))
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
