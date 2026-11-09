import View from 'ol/View';
import { fromLonLat, toLonLat } from 'ol/proj';
import { packView } from './pack';
import {
  DEFAULT_COLUMNS,
  DEFAULT_ZOOM,
  type AgentTask,
  type ViewCell,
  type ViewSpec,
} from './view';

/** A probe as the agent gives it: a pixel of an image it was shown, or a coordinate. */
export type ProbeInput =
  | {
      /** The view that image was drawn from, with the columns and cell_px it was drawn at. */
      view: ViewSpec;
      /** The image's number in the reply the agent saw it in, echoed back in the metadata. */
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
  from?: { image: number; x: number; y: number; cell: number };
}

type LonLat = [number, number];

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
  const [px, py] = fromLonLat(point);
  const res = resolutionAt(zoom);
  return [width / 2 + (px - cx) / res, height / 2 - (py - cy) / res];
}

/** Where a probe lands. Throws a message the agent can act on. */
export function locateProbe(task: AgentTask, probe: ProbeInput): LocatedProbe {
  if (!('view' in probe)) {
    if (Math.abs(probe.lat) > 90 || Math.abs(probe.lon) > 180)
      throw new Error(`(${probe.lat}, ${probe.lon}) is not a lat/lon`);
    return { lon: probe.lon, lat: probe.lat };
  }
  const { view, image, x, y } = probe;
  const where = `pixel (${x}, ${y}) of image ${image}`;
  const columns = view.columns ?? DEFAULT_COLUMNS;
  if (!view.cell_px) throw new Error(`the size image ${image} was drawn at is not known`);
  const packed = packView(view.cells, columns, view.cell_px);
  if (x < 0 || y < 0 || x >= packed.width || y >= packed.height)
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
  const [lon, lat] = pixelToLonLat(
    [task.lon, task.lat],
    zoom,
    rect.width,
    rect.height,
    x - rect.x,
    y - rect.y
  );
  return {
    lon,
    lat,
    cell: { ...cell, zoom },
    cellPx: rect.width,
    from: { image, x, y, cell: rect.index },
  };
}

/** Ground offset of a point from the task, in metres east and north. */
export function offsetMeters(task: AgentTask, lon: number, lat: number) {
  const [tx, ty] = fromLonLat([task.lon, task.lat]);
  const [px, py] = fromLonLat([lon, lat]);
  const scale = Math.cos((((task.lat + lat) / 2) * Math.PI) / 180);
  return { east_m: Math.round((px - tx) * scale), north_m: Math.round((py - ty) * scale) };
}
