import type { ViewCell } from './view';

export interface CellRect {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PackedView {
  width: number;
  height: number;
  rects: CellRect[];
}

const CHART_HEIGHT_RATIO = 0.75;
const MIN_CHART_HEIGHT = 180;

export const isChartCell = (cell: ViewCell): boolean => cell.timeseries_ids != null;

/** Map cells fill the grid left to right; a chart takes a whole row of its own, so a
 *  half-filled row is closed before it. Mirrored in the agent skill, which tells agents
 *  how big their image will be. */
export function packView(cells: ViewCell[], columns: number, cellPx: number): PackedView {
  const width = columns * cellPx;
  const chartHeight = Math.max(MIN_CHART_HEIGHT, Math.round(cellPx * CHART_HEIGHT_RATIO));
  const rects: CellRect[] = [];
  let y = 0;
  let column = 0;

  cells.forEach((cell, index) => {
    if (isChartCell(cell)) {
      if (column > 0) {
        y += cellPx;
        column = 0;
      }
      rects.push({ index, x: 0, y, width, height: chartHeight });
      y += chartHeight;
      return;
    }
    rects.push({ index, x: column * cellPx, y, width: cellPx, height: cellPx });
    column += 1;
    if (column === columns) {
      y += cellPx;
      column = 0;
    }
  });

  return { width, height: column > 0 ? y + cellPx : y, rects };
}

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const TILE_PX = 256;

/** Ground resolution of web mercator at this latitude and zoom. */
export const metersPerPixel = (lat: number, zoom: number): number =>
  (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (TILE_PX * 2 ** zoom);
