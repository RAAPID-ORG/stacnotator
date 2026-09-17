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
import type { CampaignOutFull } from '~/api/client';
import { basemapAttribution, resolveBasemapUrl } from '~/shared/imagery/tileUrls';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { createLayer, destroyLayer } from '~/shared/map/layers';
import type { LayerSpec } from '~/shared/map/types';
import type { ImageryCatalog } from '../campaign/imagery';
import { sliceRaster } from '../campaign/tileUrls';
import { collectSeriesLabels, formatDateLabel } from '../panels/Timeseries/chartData';
import { timeSeriesCache } from '../panels/Timeseries/cache';
import { savitzkyGolay } from '../panels/Timeseries/smoothing';
import { DEFAULT_TIMESERIES_CHART } from '../stores/prefs';
import { metersPerPixel, packView, type CellRect } from './pack';
import { withTaskScenes } from './scenes';
import {
  DEFAULT_COLUMNS,
  DEFAULT_ZOOM,
  fitCellPx,
  shortDateRange,
  type AgentTask,
  type ImageLimits,
  type ViewCell,
  type ViewSpec,
} from './view';

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
// runs. Rendering on a timer keeps a page in a hidden tab drawing, only slower.
const RENDER_PUMP_MS = 200;
/** Pure red, the colour agents are told marks the task. */
const FOCUS_COLOR = '#ff0000';
const FOCUS_LINE_PX = 2;
/** Below this an extent box is unreadable, so the point gets a crosshair instead. */
const MIN_BOX_PX = 6;
const CROSSHAIR_ARM_PX = 10;
/** Anything this bright in every channel is cloud, haze, snow or glare. */
const BRIGHT_CHANNEL_MIN = 200;
const JPEG_QUALITY = 0.9;
const CLOUDY_DOT_COLOR = 'rgb(162, 159, 155)';
const SERIES_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#ea580c', '#0891b2'];

export interface RenderInput {
  task: AgentTask;
  view: ViewSpec;
  limits: ImageLimits;
  campaign: CampaignOutFull;
  catalog: ImageryCatalog;
  /** Where the offscreen maps are mounted: OpenLayers needs a laid-out element. */
  stage: HTMLElement;
}

export interface RenderedImage {
  image_base64: string;
  meta: Record<string, unknown>;
}

interface CellMeta {
  i: number;
  row: number;
  col: number;
  kind: 'imagery' | 'basemap' | 'timeseries';
  /** Printed on the image, large enough to read at the size the model sees it. */
  label: string;
  warning?: string;
  [key: string]: unknown;
}

interface DrawnCell {
  image: HTMLCanvasElement | null;
  rect: CellRect;
  meta: CellMeta;
  metersPerPixel?: number;
}

type Place = Pick<CellMeta, 'i' | 'row' | 'col'>;

/**
 * One packed image and the metadata the agent reads it with. The image is fitted to the
 * model's limits so nothing is lost to downscaling, every cell carries a short label the
 * model can read, and every map cell of a point task reports the pixels inside the sample
 * extent as numbers, so an answer never hangs on a few pixels alone.
 */
export async function renderView(input: RenderInput): Promise<RenderedImage> {
  const { task, view, campaign, catalog, limits } = input;
  const cellPx = fitCellPx(view, limits);
  const columns = view.columns ?? DEFAULT_COLUMNS;
  const packed = packView(view.cells, columns, cellPx);
  const canvas = document.createElement('canvas');
  canvas.width = packed.width;
  canvas.height = packed.height;
  const ctx = canvas.getContext('2d')!;

  const scenes = await withTaskScenes(
    catalog,
    view.cells,
    [task.lon, task.lat],
    view.zoom ?? DEFAULT_ZOOM,
    cellPx
  ).catch((err: unknown) => ({
    catalog,
    empty: new Set<number>(),
    errors: [`Planet scene search failed: ${extractErrorMessage(err, 'unknown error')}`],
  }));
  const withScenes = { ...input, catalog: scenes.catalog };
  const rowTops = [...new Set(packed.rects.map((r) => r.y))];
  const place = (rect: CellRect): Place => ({
    i: rect.index,
    row: rowTops.indexOf(rect.y),
    col: Math.round(rect.x / cellPx),
  });

  const isPoint = task.geometry_wkt.startsWith('POINT');
  const extentMeters = isPoint ? (campaign.settings.sample_extent_meters ?? null) : null;
  const cells: DrawnCell[] = await Promise.all(
    packed.rects.map((rect) => {
      const cell = view.cells[rect.index];
      const drawing =
        cell.slice_id != null && scenes.empty.has(cell.slice_id)
          ? Promise.reject(new Error('no Planet scenes around this point on this date'))
          : drawCell(cell, rect, place(rect), withScenes);
      return drawing.catch(
        (err: unknown): DrawnCell => ({
          image: null,
          rect,
          meta: {
            ...place(rect),
            kind: kindOf(cell),
            label: 'no image',
            warning: err instanceof Error ? err.message : String(err),
          },
        })
      );
    })
  );

  for (const { image, rect, meta, metersPerPixel: mpp } of cells) {
    if (meta.kind !== 'timeseries') drawNoData(ctx, rect);
    if (image) ctx.drawImage(image, rect.x, rect.y);
    if (image && mpp && isPoint) {
      const sidePx = extentMeters ? extentMeters / mpp : 0;
      if (extentMeters) meta.inside_box = boxStats(image, sidePx);
      drawFocus(ctx, rect, sidePx);
    }
    drawLabel(ctx, rect, meta);
  }

  return {
    image_base64: await toBase64(canvas),
    meta: {
      task: { task_id: task.task_id, lat: task.lat, lon: task.lon },
      size: [packed.width, packed.height],
      grid: { columns, cell_px: cellPx },
      ...(view.cell_px && cellPx !== view.cell_px ? { cell_px_asked: view.cell_px } : {}),
      ...(extentMeters ? { sample_extent_meters: extentMeters } : {}),
      ...hoistShared(cells.map((c) => c.meta)),
      ...(scenes.errors.length ? { planet_errors: scenes.errors } : {}),
    },
  };
}

const kindOf = (cell: ViewCell): CellMeta['kind'] =>
  cell.timeseries_ids != null ? 'timeseries' : cell.basemap_id != null ? 'basemap' : 'imagery';

/** Source and visualization are usually the same for every cell: say them once. */
function hoistShared(cells: CellMeta[]): Record<string, unknown> {
  const shared: Record<string, unknown> = {};
  const imagery = cells.filter((c) => c.kind === 'imagery' && c.source !== undefined);
  for (const key of ['source', 'visualization']) {
    if (imagery.length > 1 && new Set(imagery.map((c) => c[key])).size === 1) {
      shared[key] = imagery[0][key];
      for (const cell of imagery) delete cell[key];
    }
  }
  return { ...shared, cells };
}

async function drawCell(
  cell: ViewCell,
  rect: CellRect,
  place: Place,
  input: RenderInput
): Promise<DrawnCell> {
  const { task, view, campaign, catalog, stage } = input;

  if (cell.timeseries_ids != null) {
    return drawChart(cell, cell.timeseries_ids, rect, place, input);
  }

  const zoom = cell.zoom ?? view.zoom ?? DEFAULT_ZOOM;
  const layers: LayerSpec[] = [];
  let kind: CellMeta['kind'];
  let label: string;
  let details: Record<string, unknown>;
  if (cell.slice_id != null) {
    kind = 'imagery';
    const target = resolveSlice(catalog, cell.slice_id, cell.visualization ?? null);
    layers.push({ kind: 'raster', ...sliceRaster(catalog, target.address) });
    label = target.dates + (cell.visualization ? `, ${target.vizName}` : '');
    details = {
      slice_id: cell.slice_id,
      dates: target.isoDates,
      source: target.sourceName,
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
    label = `${basemap.name}, date unknown`;
    details = { basemap_id: basemap.id, name: basemap.name, dates: 'unknown' };
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
  const warning = !complete
    ? 'tiles still missing when drawn: hatched areas are no data'
    : tileErrors
      ? `${tileErrors} tiles failed: hatched areas are no data`
      : undefined;
  return {
    image,
    rect,
    metersPerPixel: mpp,
    meta: {
      ...place,
      kind,
      label: `${label}, z${Math.round(zoom)}`,
      ...details,
      zoom,
      m_per_px: Number(mpp.toFixed(2)),
      ...(warning ? { warning } : {}),
    },
  };
}

function taskFootprint(wkt: string): LayerSpec | null {
  if (wkt.startsWith('POINT')) return null;
  return {
    kind: 'features',
    id: 'task-footprint',
    features: [{ geometry: new GeoJSONFormat().writeGeometryObject(new WKT().readGeometry(wkt)) }],
    style: { stroke: { color: FOCUS_COLOR, width: FOCUS_LINE_PX } },
    zIndex: 5,
  };
}

interface SliceTarget {
  address: { sourceId: number; collectionId: number; sliceIndex: number; vizId: string };
  sourceName: string;
  vizName: string;
  dates: string;
  isoDates: string;
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
      vizName: viz.name,
      dates: shortDateRange(slice.start_date, slice.end_date),
      isoDates: `${slice.start_date.slice(0, 10)}/${slice.end_date.slice(0, 10)}`,
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
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
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

/** The pixels inside the sample extent as drawn, before anything is put on top. At least
 *  the centre pixel is read, however small the extent is at this zoom. */
function boxStats(image: HTMLCanvasElement, sidePx: number) {
  const side = Math.max(1, Math.round(sidePx));
  const x0 = Math.round((image.width - side) / 2);
  const y0 = Math.round((image.height - side) / 2);
  const { data } = image.getContext('2d')!.getImageData(x0, y0, side, side);
  let [r, g, b, seen, bright] = [0, 0, 0, 0, 0];
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] === 0) continue;
    seen += 1;
    r += data[p];
    g += data[p + 1];
    b += data[p + 2];
    if (Math.min(data[p], data[p + 1], data[p + 2]) >= BRIGHT_CHANNEL_MIN) bright += 1;
  }
  if (seen === 0) return { no_data_share: 1 };
  const [mr, mg, mb] = [r / seen, g / seen, b / seen].map(Math.round);
  return {
    mean_rgb: [mr, mg, mb],
    // Excess green of the drawn colours, -1..1: above about 0.1 usually means living
    // vegetation in a true colour rendering.
    green_index: Number(((2 * mg - mr - mb) / Math.max(1, 2 * mg + mr + mb)).toFixed(2)),
    bright_share: Number((bright / seen).toFixed(2)),
    no_data_share: Number((1 - (seen * 4) / data.length).toFixed(2)),
  };
}

async function drawChart(
  cell: ViewCell,
  ids: number[],
  rect: CellRect,
  place: Place,
  { task, campaign, stage }: RenderInput
): Promise<DrawnCell> {
  const { lat, lon } = task;
  const data = (await timeSeriesCache.get(ids, { lat, lon })) ?? {};
  const series = ids.map((id) => campaign.time_series.find((t) => t.id === id));
  const times = collectSeriesLabels(ids, data);
  const { smoothing } = DEFAULT_TIMESERIES_CHART;
  const lines = ids.map((id) => {
    const byTime = new Map((data[id] ?? []).map((row) => [row.time, row]));
    const raw = times.map((time) => {
      const row = byTime.get(time);
      return !row || (cell.remove_cloudy && row.cloud === 1) ? null : row.values;
    });
    const cloudy = times.map((time) => byTime.get(time)?.cloud === 1);
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
      labels: times.map(formatDateLabel),
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
      layout: { padding: { top: labelHeight(rect) + 4, right: 8, left: 4, bottom: 4 } },
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

  const columns = ['date', 'value', 'cloudy', ...(cell.smoothed ? ['smoothed'] : [])];
  return {
    image,
    rect,
    meta: {
      ...place,
      kind: 'timeseries',
      label: ['time series', cell.remove_cloudy ? 'cloudy removed' : 'grey dots cloudy']
        .concat(cell.smoothed ? ['smoothed'] : [])
        .join(', '),
      series: ids.map((id, i) => ({
        timeseries_id: id,
        name: series[i]?.name,
        index: series[i]?.ts_type,
        columns,
        rows: times.flatMap((time, t) => {
          const value = lines[i].raw[t];
          if (value == null) return [];
          const row = [time.slice(0, 10), round(value), lines[i].cloudy[t] ? 1 : 0];
          const smooth = lines[i].shown[t];
          return [cell.smoothed && smooth != null ? [...row, round(smooth)] : row];
        }),
      })),
    },
  };
}

/** What no tile covers stays transparent in a map cell: hatched underneath, so a gap
 *  cannot pass for dark water or shadow. */
function drawNoData(ctx: CanvasRenderingContext2D, rect: CellRect) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.fillStyle = '#6b6b6b';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = '#8f8f8f';
  ctx.lineWidth = 4;
  for (let d = -rect.height; d < rect.width; d += 16) {
    ctx.beginPath();
    ctx.moveTo(rect.x + d, rect.y + rect.height);
    ctx.lineTo(rect.x + d + rect.height, rect.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** The sample extent as a box drawn just outside it, so every pixel inside stays visible.
 *  A polygon task carries its own outline, drawn as a map layer. */
function drawFocus(ctx: CanvasRenderingContext2D, rect: CellRect, sidePx: number) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  ctx.save();
  ctx.lineWidth = FOCUS_LINE_PX;
  ctx.strokeStyle = FOCUS_COLOR;
  ctx.beginPath();
  if (sidePx >= MIN_BOX_PX) {
    const half = sidePx / 2 + FOCUS_LINE_PX / 2;
    ctx.rect(cx - half, cy - half, 2 * half, 2 * half);
  } else {
    const gap = Math.max(4, sidePx / 2 + 3);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      ctx.moveTo(cx + dx * gap, cy + dy * gap);
      ctx.lineTo(cx + dx * (gap + CROSSHAIR_ARM_PX), cy + dy * (gap + CROSSHAIR_ARM_PX));
    }
  }
  ctx.stroke();
  ctx.restore();
}

const fontPx = (rect: CellRect) => Math.max(13, Math.min(22, Math.round(rect.width * 0.07)));
const labelHeight = (rect: CellRect) => Math.round(fontPx(rect) * 1.4);

function drawLabel(ctx: CanvasRenderingContext2D, rect: CellRect, meta: CellMeta) {
  const text = `#${meta.i} ${meta.label}${meta.warning ? ' (!)' : ''}`;
  const height = labelHeight(rect);
  ctx.save();
  ctx.font = `bold ${fontPx(rect)}px sans-serif`;
  ctx.fillStyle = meta.warning ? 'rgba(160,0,0,0.85)' : 'rgba(0,0,0,0.75)';
  ctx.fillRect(rect.x, rect.y, Math.min(rect.width, ctx.measureText(text).width + 10), height);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, rect.x + 5, rect.y + height / 2, rect.width - 10);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  ctx.restore();
}

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
