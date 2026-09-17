import {
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Title,
} from 'chart.js';
import OlMap from 'ol/Map';
import View from 'ol/View';
import GeoJSONFormat from 'ol/format/GeoJSON';
import WKT from 'ol/format/WKT';
import type BaseLayer from 'ol/layer/Base';
import TileLayer from 'ol/layer/Tile';
import { fromLonLat } from 'ol/proj';
import type TileSource from 'ol/source/Tile';
import type { CampaignOutFull, RenderJobOut, RenderJobResult, ViewCell } from '~/api/client';
import { basemapAttribution, resolveBasemapUrl } from '~/shared/imagery/tileUrls';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { createLayer, destroyLayer } from '~/shared/map/layers';
import type { LayerSpec } from '~/shared/map/types';
import { sliceDateRange, type ImageryCatalog } from '../campaign/imagery';
import { sliceRaster } from '../campaign/tileUrls';
import { collectSeriesLabels, formatDateLabel } from '../panels/Timeseries/chartData';
import { timeSeriesCache } from '../panels/Timeseries/cache';
import { savitzkyGolay } from '../panels/Timeseries/smoothing';
import { DEFAULT_TIMESERIES_CHART } from '../stores/prefs';
import { metersPerPixel, packView, type CellRect } from './pack';
import { withTaskScenes } from './scenes';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Legend,
  Title
);

const MAP_TIMEOUT_MS = 30_000;
// OpenLayers schedules frames with requestAnimationFrame, which a background tab never
// runs. Rendering on a timer keeps a host in a hidden tab drawing, only slower.
const RENDER_PUMP_MS = 200;
const CAPTION_PX = 18;
/** Pure red, the colour agents are told marks the task. */
const FOCUS_COLOR = '#ff0000';
const CROSSHAIR_PX = 24;
const CROSSHAIR_GAP_PX = 4;
/** Below this an extent box is unreadable, so the point gets a crosshair instead. */
const MIN_BOX_PX = 6;
const JPEG_QUALITY = 0.9;
const CLOUDY_DOT_COLOR = 'rgb(162, 159, 155)';
const SERIES_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#ea580c', '#0891b2'];

export interface RenderInput {
  job: RenderJobOut;
  campaign: CampaignOutFull;
  catalog: ImageryCatalog;
  /** Where the offscreen maps are mounted: OpenLayers needs a laid-out element. */
  stage: HTMLElement;
}

interface CellMeta {
  index: number;
  kind: 'imagery' | 'basemap' | 'timeseries';
  x: number;
  y: number;
  width: number;
  height: number;
  caption: string;
  [key: string]: unknown;
}

export async function renderView({
  job,
  campaign,
  catalog,
  stage,
}: RenderInput): Promise<RenderJobResult> {
  const { view, task } = job;
  const packed = packView(view.cells, view.columns ?? 4, view.cell_px ?? 320);
  const canvas = document.createElement('canvas');
  canvas.width = packed.width;
  canvas.height = packed.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const scenes = await withTaskScenes(
    catalog,
    view.cells,
    [task.lon, task.lat],
    view.zoom ?? 15,
    view.cell_px ?? 320
  ).catch((err: unknown) => ({
    catalog,
    empty: new Set<number>(),
    errors: [`Planet scene search failed: ${extractErrorMessage(err, 'unknown error')}`],
  }));
  const input = { job, campaign, catalog: scenes.catalog, stage };
  const cells = await Promise.all(
    packed.rects.map((rect) => {
      const cell = view.cells[rect.index];
      const rendering =
        cell.slice_id != null && scenes.empty.has(cell.slice_id)
          ? Promise.reject(new Error('no Planet scenes around this point on this date'))
          : renderCell(cell, rect, input);
      return rendering.catch((err: unknown): { image: null; meta: CellMeta } => ({
        image: null,
        meta: {
          ...rectMeta(rect),
          kind: kindOf(cell),
          caption: `no image: ${err instanceof Error ? err.message : String(err)}`,
        },
      }));
    })
  );

  const isPoint = task.geometry_wkt.startsWith('POINT');
  const extentMeters = campaign.settings.sample_extent_meters ?? null;
  for (const { image, meta } of cells) {
    if (image) ctx.drawImage(image, meta.x, meta.y);
    if (image && isPoint && meta.kind !== 'timeseries') drawFocus(ctx, meta, extentMeters);
    drawCaption(ctx, meta);
  }

  return {
    mime_type: 'image/jpeg',
    image_base64: await toBase64(canvas),
    meta: {
      task: { task_id: task.task_id, lat: task.lat, lon: task.lon },
      width: packed.width,
      height: packed.height,
      cells: cells.map((c) => c.meta),
      ...(isPoint && extentMeters ? { sample_extent_meters: extentMeters } : {}),
      ...(scenes.errors.length ? { planet_errors: scenes.errors } : {}),
    },
  };
}

const kindOf = (cell: ViewCell): CellMeta['kind'] =>
  cell.timeseries_ids != null ? 'timeseries' : cell.basemap_id != null ? 'basemap' : 'imagery';

const rectMeta = ({ index, x, y, width, height }: CellRect) => ({ index, x, y, width, height });

async function renderCell(
  cell: ViewCell,
  rect: CellRect,
  input: RenderInput
): Promise<{ image: HTMLCanvasElement; meta: CellMeta }> {
  const { job, campaign, catalog, stage } = input;
  const { task, view } = job;

  if (cell.timeseries_ids != null) {
    return renderChart(cell, cell.timeseries_ids, rect, input);
  }

  const zoom = cell.zoom ?? view.zoom ?? 15;
  const layers: LayerSpec[] = [];
  let kind: CellMeta['kind'];
  let caption: string;
  let details: Record<string, unknown>;
  if (cell.slice_id != null) {
    kind = 'imagery';
    const target = resolveSlice(catalog, cell.slice_id, cell.visualization ?? null);
    layers.push({ kind: 'raster', ...sliceRaster(catalog, target.address) });
    caption = `${target.sourceName} | ${target.dates} | ${target.vizName}`;
    details = {
      slice_id: cell.slice_id,
      source: target.sourceName,
      collection: target.collectionName,
      slice_name: target.sliceName,
      dates: target.dates,
      visualization: target.vizName,
    };
  } else {
    const basemap = catalog.basemaps.get(cell.basemap_id!);
    if (!basemap) throw new Error(`unknown basemap ${cell.basemap_id}`);
    layers.push({
      kind: 'raster',
      id: `basemap-${basemap.id}`,
      url: resolveBasemapUrl(campaign.id, basemap),
      auth: 'none',
      maxZoom: basemap.max_native_zoom ?? undefined,
      attribution: basemapAttribution(basemap.url),
    });
    kind = 'basemap';
    caption = basemap.name;
    details = { basemap_id: basemap.id, name: basemap.name };
  }

  const footprint = taskFootprint(task.geometry_wkt);
  if (footprint) layers.push(footprint);

  const mpp = metersPerPixel(task.lat, zoom);
  const { image, tileErrors, complete } = await renderMap(
    stage,
    layers,
    [task.lon, task.lat],
    zoom,
    rect.width
  );
  return {
    image,
    meta: {
      ...rectMeta(rect),
      ...details,
      kind,
      caption: `${caption} | z${zoom} | ${formatMeters(mpp * rect.width)} across`,
      zoom,
      meters_per_pixel: Number(mpp.toFixed(3)),
      tile_errors: tileErrors,
      complete,
    },
  };
}

function taskFootprint(wkt: string): LayerSpec | null {
  if (wkt.startsWith('POINT')) return null;
  return {
    kind: 'features',
    id: 'task-footprint',
    features: [{ geometry: new GeoJSONFormat().writeGeometryObject(new WKT().readGeometry(wkt)) }],
    style: { stroke: { color: FOCUS_COLOR, width: 3 } },
    zIndex: 5,
  };
}

interface SliceTarget {
  address: { sourceId: number; collectionId: number; sliceIndex: number; vizId: string };
  sourceName: string;
  collectionName: string;
  sliceName: string;
  dates: string;
  vizName: string;
}

function resolveSlice(cat: ImageryCatalog, sliceId: number, vizName: string | null): SliceTarget {
  for (const collection of cat.collections.values()) {
    const sliceIndex = collection.slices.findIndex((s) => s.id === sliceId);
    if (sliceIndex < 0) continue;
    const source = cat.sources.get(cat.sourceOf.get(collection.id)!)!;
    const viz = vizName
      ? source.visualizations.find((v) => v.name === vizName)
      : source.visualizations[0];
    if (!viz) throw new Error(`no visualization ${vizName} on ${source.name}`);
    const slice = collection.slices[sliceIndex];
    return {
      address: {
        sourceId: source.id,
        collectionId: collection.id,
        sliceIndex,
        vizId: String(viz.id),
      },
      sourceName: source.name,
      collectionName: collection.name,
      sliceName: slice.name,
      dates: sliceDateRange(slice),
      vizName: viz.name,
    };
  }
  throw new Error(`unknown slice ${sliceId}`);
}

async function renderMap(
  stage: HTMLElement,
  specs: LayerSpec[],
  center: [number, number],
  zoom: number,
  size: number
): Promise<{ image: HTMLCanvasElement; tileErrors: number; complete: boolean }> {
  const target = document.createElement('div');
  target.style.width = `${size}px`;
  target.style.height = `${size}px`;
  stage.appendChild(target);

  const layers = specs.map(createLayer);
  let tileErrors = 0;
  const countError = () => (tileErrors += 1);
  const tileSources = layers
    .map((layer) => (layer instanceof TileLayer ? (layer.getSource() as TileSource | null) : null))
    .filter((source): source is TileSource => source != null);
  tileSources.forEach((source) => source.on('tileloaderror', countError));

  const map = new OlMap({
    target,
    layers,
    controls: [],
    interactions: [],
    pixelRatio: 1,
    view: new View({ center: fromLonLat(center), zoom }),
  });
  const pump = setInterval(() => map.renderSync(), RENDER_PUMP_MS);

  try {
    const complete = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), MAP_TIMEOUT_MS);
      map.once('rendercomplete', () => {
        clearTimeout(timer);
        resolve(true);
      });
      map.renderSync();
    });
    return { image: composite(target, size), tileErrors, complete };
  } finally {
    clearInterval(pump);
    tileSources.forEach((source) => source.un('tileloaderror', countError));
    map.setTarget(undefined);
    layers.forEach((layer: BaseLayer) => destroyLayer(layer));
    target.remove();
  }
}

/** Flattens a map's layer canvases into one, the way OpenLayers' own export example does. */
function composite(target: HTMLElement, size: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d')!;
  for (const layerCanvas of target.querySelectorAll<HTMLCanvasElement>('.ol-layer canvas')) {
    if (layerCanvas.width === 0) continue;
    const parent = layerCanvas.parentElement;
    const opacity = parent?.style.opacity || layerCanvas.style.opacity;
    ctx.globalAlpha = opacity === '' ? 1 : Number(opacity);
    const transform = /^matrix\(([^(]*)\)$/.exec(layerCanvas.style.transform);
    const [a, b, c, d, e, f] = transform
      ? transform[1].split(',').map(Number)
      : [
          parseFloat(layerCanvas.style.width) / layerCanvas.width,
          0,
          0,
          parseFloat(layerCanvas.style.height) / layerCanvas.height,
          0,
          0,
        ];
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(layerCanvas, 0, 0);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}

async function renderChart(
  cell: ViewCell,
  ids: number[],
  rect: CellRect,
  { job, campaign, stage }: RenderInput
): Promise<{ image: HTMLCanvasElement; meta: CellMeta }> {
  const { lat, lon } = job.task;
  const data = (await timeSeriesCache.get(ids, { lat, lon })) ?? {};
  const series = ids.map((id) => campaign.time_series.find((t) => t.id === id));
  const labels = collectSeriesLabels(ids, data);
  const { smoothing } = DEFAULT_TIMESERIES_CHART;
  const lines = ids.map((id) => {
    const byTime = new Map((data[id] ?? []).map((row) => [row.time, row]));
    const raw = labels.map((time) => {
      const row = byTime.get(time);
      return !row || (cell.remove_cloudy && row.cloud === 1) ? null : row.values;
    });
    const cloudy = labels.map((time) => byTime.get(time)?.cloud === 1);
    return {
      raw,
      cloudy,
      shown: cell.smoothed ? savitzkyGolay(raw, smoothing.window, smoothing.order) : raw,
    };
  });

  const canvas = document.createElement('canvas');
  canvas.width = rect.width;
  canvas.height = rect.height;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  stage.appendChild(canvas);
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels.map(formatDateLabel),
      datasets: ids.map((id, i) => {
        const color = SERIES_COLORS[i % SERIES_COLORS.length];
        const pointColors = lines[i].cloudy.map((cloudy) => (cloudy ? CLOUDY_DOT_COLOR : color));
        return {
          label: series[i]?.name ?? `Series ${id}`,
          data: lines[i].shown,
          borderColor: color,
          backgroundColor: color,
          pointBackgroundColor: pointColors,
          pointBorderColor: pointColors,
          pointRadius: lines[i].raw.map((value) => (value == null ? 0 : 2)),
          spanGaps: true,
        };
      }),
    },
    options: {
      animation: false,
      responsive: false,
      devicePixelRatio: 1,
      layout: { padding: { top: CAPTION_PX + 4, right: 8, left: 4, bottom: 4 } },
      plugins: { legend: { position: 'top', align: 'end' } },
    },
  });

  const image = document.createElement('canvas');
  image.width = rect.width;
  image.height = rect.height;
  const ctx = image.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.drawImage(canvas, 0, 0);
  chart.destroy();
  canvas.remove();

  return {
    image,
    meta: {
      ...rectMeta(rect),
      kind: 'timeseries',
      caption: [
        `Time series at ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
        cell.remove_cloudy ? 'cloudy removed' : 'grey dots cloudy',
        ...(cell.smoothed ? ['smoothed'] : []),
      ].join(' | '),
      remove_cloudy: !!cell.remove_cloudy,
      smoothed: !!cell.smoothed,
      series: ids.map((id, i) => ({
        timeseries_id: id,
        name: series[i]?.name,
        index: series[i]?.ts_type,
        data_source: series[i]?.data_source,
        columns: cell.smoothed
          ? ['time', 'value', 'cloudy', 'smoothed']
          : ['time', 'value', 'cloudy'],
        values: labels.flatMap((time, t) => {
          const value = lines[i].raw[t];
          if (value == null) return [];
          const row = [time, round(value), lines[i].cloudy[t] ? 1 : 0];
          const smooth = lines[i].shown[t];
          return [cell.smoothed && smooth != null ? [...row, round(smooth)] : row];
        }),
      })),
    },
  };
}

/** The sample extent as a box around a point task, the way the annotation page frames
 *  it. A polygon task carries its own outline, drawn as a map layer. */
function drawFocus(ctx: CanvasRenderingContext2D, cell: CellMeta, extentMeters: number | null) {
  if (typeof cell.meters_per_pixel !== 'number') return;
  const side = extentMeters ? extentMeters / cell.meters_per_pixel : 0;
  if (side < MIN_BOX_PX) {
    drawCrosshair(ctx, cell);
    return;
  }
  const x = cell.x + (cell.width - side) / 2;
  const y = cell.y + (cell.height - side) / 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 5;
  ctx.strokeRect(x, y, side, side);
  ctx.strokeStyle = FOCUS_COLOR;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, side, side);
}

function drawCrosshair(ctx: CanvasRenderingContext2D, rect: CellMeta) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const [inner, outer] = [CROSSHAIR_GAP_PX, CROSSHAIR_PX / 2];
  ctx.beginPath();
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    ctx.moveTo(cx + dx * inner, cy + dy * inner);
    ctx.lineTo(cx + dx * outer, cy + dy * outer);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = FOCUS_COLOR;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function drawCaption(ctx: CanvasRenderingContext2D, cell: CellMeta) {
  const text = `#${cell.index} ${cell.caption}`;
  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(cell.x, cell.y, Math.min(cell.width, ctx.measureText(text).width + 8), CAPTION_PX);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cell.x + 4, cell.y + CAPTION_PX / 2, cell.width - 8);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.width - 1, cell.height - 1);
}

const formatMeters = (m: number): string =>
  m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`;

const round = (value: number): number => Math.round(value * 1000) / 1000;

function toBase64(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('could not encode the view'));
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}
