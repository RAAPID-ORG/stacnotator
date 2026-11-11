import View from 'ol/View';
import { fromLonLat, toLonLat } from 'ol/proj';
import { packView } from './pack';
import {
  DEFAULT_COLUMNS,
  DEFAULT_ZOOM,
  fitCellPx,
  viewCenter,
  type AgentTask,
  type ImageLimits,
  type ViewCell,
  type ViewSpec,
} from './view';

/** A probe as the agent gives it: a pixel of an image it was shown, or a coordinate. */
export type ProbeInput =
  | {
      /** The view that image was drawn from, with the columns and cell_px it was drawn at. */
      view: ViewSpec;
      /** The reply the agent saw the image in and its number there, echoed in the metadata. */
      reply: number;
      image: number;
      x: number;
      y: number;
    }
  | { lat: number; lon: number };

export interface LocatedProbe {
  lon: number;
  lat: number;
  /** The map cell the pixel fell on, with the zoom and width it was drawn at. */
  cell?: ViewCell & { zoom: number };
  cellPx?: number;
  from?: { reply: number; image: number; x: number; y: number; cell: number };
}

type LonLat = [number, number];

const projectNear = (center: LonLat, point: LonLat) =>
  fromLonLat([point[0] + 360 * Math.round((center[0] - point[0]) / 360), point[1]]);

/** OpenLayers' own resolution for a zoom, so a pixel maps back exactly as the map drew it. */
const resolutionAt = (zoom: number): number => new View().getResolutionForZoom(zoom);

/** The coordinate under pixel (x, y) of a map cell `width` x `height` drawn centred on
 *  `center` at `zoom`, x to the right and y down from the cell's top-left corner. */
export function pixelToLonLat(
  center: LonLat,
  zoom: number,
  width: number,
  height: number,
  x: number,
  y: number
): LonLat {
  const [cx, cy] = fromLonLat(center);
  const res = resolutionAt(zoom);
  const [lon, lat] = toLonLat([cx + (x - width / 2) * res, cy - (y - height / 2) * res]);
  return [lon, lat];
}

export function lonLatToPixel(
  center: LonLat,
  zoom: number,
  width: number,
  height: number,
  point: LonLat
): [number, number] {
  const [cx, cy] = fromLonLat(center);
  const [px, py] = projectNear(center, point);
  const res = resolutionAt(zoom);
  return [width / 2 + (px - cx) / res, height / 2 - (py - cy) / res];
}

/** Where a probe lands. Throws a message the agent can act on. */
export function locateProbe(task: AgentTask, probe: ProbeInput): LocatedProbe {
  if (!('view' in probe)) {
    if (
      !Number.isFinite(probe.lat) ||
      !Number.isFinite(probe.lon) ||
      Math.abs(probe.lat) > 85.05112878 ||
      Math.abs(probe.lon) > 180
    )
      throw new Error(`(${probe.lat}, ${probe.lon}) is not a lat/lon`);
    return { lon: probe.lon, lat: probe.lat };
  }
  const { view, reply, image, x, y } = probe;
  const where = `pixel (${x}, ${y}) of reply ${reply} image ${image}`;
  const columns = view.columns ?? DEFAULT_COLUMNS;
  if (!view.cell_px) throw new Error(`the size image ${image} was drawn at is not known`);
  const packed = packView(view.cells, columns, view.cell_px);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= packed.width ||
    y >= packed.height
  )
    throw new Error(`${where} is outside the ${packed.width}x${packed.height} image`);
  const rect = packed.rects.find(
    (r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height
  );
  const maps = () =>
    packed.rects
      .filter((r) => view.cells[r.index].timeseries_ids == null)
      .map((r) => `#${r.index} [${r.x}, ${r.y}, ${r.width}, ${r.height}]`)
      .join(', ');
  if (!rect)
    throw new Error(`${where} is on an empty part of the image; its maps (x, y, w, h): ${maps()}`);
  const cell = view.cells[rect.index];
  if (cell.timeseries_ids != null)
    throw new Error(
      `${where} is on time series chart #${rect.index}, not on a map; maps (x, y, w, h): ${maps()}`
    );
  const zoom = cell.zoom ?? view.zoom ?? DEFAULT_ZOOM;
  const center = viewCenter(task, view, cell);
  const [lon, lat] = pixelToLonLat(
    [center.lon, center.lat],
    zoom,
    rect.width,
    rect.height,
    x - rect.x,
    y - rect.y
  );
  return {
    lon,
    lat,
    cell: { ...cell, zoom, ...(cell.center || view.center ? { center } : {}) },
    cellPx: rect.width,
    from: { reply, image, x, y, cell: rect.index },
  };
}

export interface ProbeOptions {
  timeseries_ids?: number[];
  remove_cloudy?: boolean;
  smoothed?: boolean;
}

/** The view a probe reply is drawn as: each map cell a point was picked on, then one chart
 *  per time series. Each map covers the same ground it did when picked on, whatever size its
 *  cell is drawn at now, so every point picked on it stays in frame. */
export function probeView(
  probes: LocatedProbe[],
  timeseriesIds: number[],
  options: ProbeOptions,
  limits: ImageLimits
): ViewSpec {
  const maps = new Map<string, { cell: ViewCell & { zoom: number }; px: number }>();
  for (const { cell, cellPx } of probes)
    if (cell && cellPx) maps.set(JSON.stringify([cell, cellPx]), { cell, px: cellPx });
  const picked = [...maps.values()];
  const charts = timeseriesIds.map((id) => ({
    timeseries_ids: [id],
    remove_cloudy: options.remove_cloudy,
    smoothed: options.smoothed,
  }));
  const view: ViewSpec = {
    cells: [...picked.map(({ cell }) => cell), ...charts],
    columns: picked.length > 4 ? 3 : picked.length || 2,
    cell_px: picked[0]?.px ?? 512,
  };
  const cellPx = fitCellPx(view, limits);
  view.cell_px = cellPx;
  picked.forEach(({ cell, px }, i) => {
    view.cells[i] = { ...cell, zoom: Math.round((cell.zoom + Math.log2(cellPx / px)) * 100) / 100 };
  });
  return view;
}

/** Ground offset of a point from the task, in metres east and north. */
export function offsetMeters(task: AgentTask, lon: number, lat: number) {
  const [tx, ty] = fromLonLat([task.lon, task.lat]);
  const [px, py] = projectNear([task.lon, task.lat], [lon, lat]);
  const scale = Math.cos((((task.lat + lat) / 2) * Math.PI) / 180);
  return { east_m: Math.round((px - tx) * scale), north_m: Math.round((py - ty) * scale) };
}
