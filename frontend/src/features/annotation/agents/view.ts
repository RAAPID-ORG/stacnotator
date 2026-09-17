import type { CampaignOutFull } from '~/api/client';
import { isSceneSource } from '../campaign/scenes';
import { metersPerPixel, packView } from './pack';

/** What an agent can ask to see, and what it is told the campaign holds. The MCP server
 *  passes these through to the render page, so this file is their only definition. */

export interface AgentTask {
  task_id: number;
  lat: number;
  lon: number;
  geometry_wkt: string;
}

/** One panel of a view: exactly one of a slice, a basemap or a time series chart. */
export interface ViewCell {
  slice_id?: number;
  /** Visualization name of the slice's source; its first one when omitted. */
  visualization?: string;
  basemap_id?: number;
  timeseries_ids?: number[];
  remove_cloudy?: boolean;
  smoothed?: boolean;
  zoom?: number;
}

export interface ViewSpec {
  cells: ViewCell[];
  columns?: number;
  cell_px?: number;
  zoom?: number;
}

/** The largest image the agent's model takes in without shrinking it. Views are fitted
 *  to it, so what the model sees is exactly what was drawn. */
export interface ImageLimits {
  max_edge_px: number;
  max_megapixels: number;
}

export const DEFAULT_COLUMNS = 4;
export const DEFAULT_CELL_PX = 320;
export const DEFAULT_ZOOM = 15;
const MIN_CELL_PX = 96;
const MAX_CELLS = 36;
/** A first look, spread over the whole season: the agent asks for the dates in between. */
const FIRST_LOOK_DATES = 4;
const CHIP_PX = 384;
/** A chip is zoomed so the sample extent spans about this share of it: big enough to read
 *  its colour, with a field's worth of surroundings to read it against. */
const EXTENT_SHARE_OF_CHIP = 1 / 6;
const MAX_CHIP_ZOOM = 18;
/** Past a source's native zoom only so far: a few upsampled pixels still read as
 *  colour patches, many are just blur. */
const ZOOM_PAST_NATIVE = 2;

/** Throws a message the agent can act on. */
export function checkView(view: ViewSpec): void {
  const columns = view.columns ?? DEFAULT_COLUMNS;
  const cellPx = view.cell_px ?? DEFAULT_CELL_PX;
  if (!view.cells?.length || view.cells.length > MAX_CELLS)
    throw new Error(`a view holds 1-${MAX_CELLS} cells`);
  if (columns < 1 || columns > 8) throw new Error('columns must be 1-8');
  if (cellPx < MIN_CELL_PX || cellPx > 1024) throw new Error('cell_px must be 96-1024');
  for (const cell of view.cells) {
    const kinds = [cell.slice_id, cell.basemap_id, cell.timeseries_ids].filter((v) => v != null);
    if (kinds.length !== 1)
      throw new Error('a cell names exactly one of slice_id, basemap_id, timeseries_ids');
    if (cell.timeseries_ids == null && (cell.remove_cloudy || cell.smoothed))
      throw new Error('remove_cloudy and smoothed apply to time series cells only');
  }
}

/** The cell size to draw a view at: the one asked for, or the largest smaller one whose
 *  image fits the model's limits. */
export function fitCellPx(view: ViewSpec, limits: ImageLimits): number {
  const columns = view.columns ?? DEFAULT_COLUMNS;
  const fits = (cellPx: number) => {
    const { width, height } = packView(view.cells, columns, cellPx);
    return (
      Math.max(width, height) <= limits.max_edge_px &&
      width * height <= limits.max_megapixels * 1_000_000
    );
  };
  let cellPx = view.cell_px ?? DEFAULT_CELL_PX;
  while (!fits(cellPx)) {
    if (cellPx <= MIN_CELL_PX)
      throw new Error(
        'this view does not fit your image limits even at cell_px 96: use fewer cells or columns'
      );
    cellPx = Math.max(MIN_CELL_PX, cellPx - 8);
  }
  return cellPx;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "May 2025" for a whole month, "3-10 May 2025", "28 Apr-5 May 2025", "12 May 2025". */
export function shortDateRange(start: string, end: string): string {
  const [ys, ms, ds] = start.slice(0, 10).split('-').map(Number);
  const [ye, me, de] = end.slice(0, 10).split('-').map(Number);
  const lastDay = new Date(Date.UTC(ye, me, 0)).getUTCDate();
  if (ys === ye && ms === me && ds === 1 && de === lastDay) return `${MONTHS[ms - 1]} ${ys}`;
  if (ys === ye && ms === me && ds === de) return `${ds} ${MONTHS[ms - 1]} ${ys}`;
  if (ys === ye && ms === me) return `${ds}-${de} ${MONTHS[ms - 1]} ${ys}`;
  if (ys === ye) return `${ds} ${MONTHS[ms - 1]}-${de} ${MONTHS[me - 1]} ${ys}`;
  return `${ds} ${MONTHS[ms - 1]} ${ys}-${de} ${MONTHS[me - 1]} ${ye}`;
}

/** The zoom at which `meters` spans `px` pixels at this latitude. */
const zoomForSpan = (lat: number, meters: number, px: number): number =>
  Math.log2(metersPerPixel(lat, 0) / (meters / px));

export function campaignContext(campaign: CampaignOutFull) {
  const { settings } = campaign;
  const imagery = [...campaign.imagery_sources]
    .sort((a, b) => a.display_order - b.display_order)
    .map((source) => {
      // Scene slices have no tiles until a view searches around the task.
      const onDemand = isSceneSource(source);
      const collections = source.collections
        .map((collection) => {
          const cover = collection.slices[collection.cover_slice_index];
          const usable = collection.slices.filter((s) => onDemand || s.tile_urls.length > 0);
          return {
            collection_id: collection.id,
            name: collection.name,
            cover_slice_id: cover && usable.includes(cover) ? cover.id : null,
            slices: usable.map(({ id, name, start_date, end_date }) => ({
              slice_id: id,
              name,
              start_date,
              end_date,
            })),
          };
        })
        .filter((collection) => collection.slices.length > 0)
        .sort((a, b) => a.slices[0].start_date.localeCompare(b.slices[0].start_date));
      return {
        source_id: source.id,
        name: source.name,
        on_demand: onDemand,
        default_zoom: source.default_zoom,
        max_native_zoom: source.max_native_zoom ?? null,
        visualizations: source.visualizations.map((v) => v.name),
        collections,
      };
    })
    .filter((source) => source.collections.length > 0);

  return {
    campaign_id: campaign.id,
    name: campaign.name,
    bbox: [settings.bbox_west, settings.bbox_south, settings.bbox_east, settings.bbox_north],
    sample_extent_meters: settings.sample_extent_meters ?? null,
    guide_markdown: settings.guide_markdown ?? null,
    labels: settings.labels,
    form_fields: settings.form_fields ?? [],
    imagery,
    basemaps: campaign.basemaps.map((b) => ({
      basemap_id: b.id,
      name: b.name,
      max_native_zoom: b.max_native_zoom ?? null,
    })),
    timeseries: campaign.time_series.map((t) => ({
      timeseries_id: t.id,
      name: t.name,
      group: t.window_name,
      data_source: t.data_source,
      index: t.ts_type,
      start_ym: t.start_ym,
      end_ym: t.end_ym,
    })),
  };
}

export type CampaignContext = ReturnType<typeof campaignContext>;

/** A light first look: a few period covers spread over the season, zoomed onto the sample
 *  extent, with the time series, and a basemap pair for the surroundings and the detail.
 *  The agent asks for more of the same point from there. */
export function defaultViews(context: CampaignContext): ViewSpec[] {
  const first = context.imagery[0];
  const sourceZoom = first?.default_zoom ?? DEFAULT_ZOOM;
  const [, south, , north] = context.bbox;
  const extent = context.sample_extent_meters;
  const chipZoom = extent
    ? Math.min(
        MAX_CHIP_ZOOM,
        (first?.max_native_zoom ?? MAX_CHIP_ZOOM) + ZOOM_PAST_NATIVE,
        Math.floor(zoomForSpan((south + north) / 2, extent / EXTENT_SHARE_OF_CHIP, CHIP_PX))
      )
    : sourceZoom;
  const allCovers = (first?.collections ?? []).flatMap((c) =>
    c.cover_slice_id != null ? [c.cover_slice_id] : []
  );
  const covers: ViewCell[] = spreadOver(allCovers, FIRST_LOOK_DATES).map((slice_id) => ({
    slice_id,
  }));
  const series: ViewCell[] = context.timeseries.length
    ? [
        {
          timeseries_ids: context.timeseries.slice(0, 8).map((t) => t.timeseries_id),
          remove_cloudy: true,
        },
      ]
    : [];

  const views: ViewSpec[] = [];
  if (covers.length) {
    views.push({
      cells: [...covers, ...series],
      columns: Math.min(DEFAULT_COLUMNS, covers.length),
      cell_px: CHIP_PX,
      zoom: chipZoom,
    });
  } else if (series.length) {
    views.push({ cells: series, columns: 2, cell_px: 512, zoom: chipZoom });
  }
  const basemap = context.basemaps[0];
  if (basemap) {
    views.push({
      cells: [
        { basemap_id: basemap.basemap_id, zoom: Math.max(1, sourceZoom - 2) },
        { basemap_id: basemap.basemap_id, zoom: Math.min(20, chipZoom + 1) },
      ],
      columns: 2,
      cell_px: 512,
      zoom: sourceZoom,
    });
  }
  return views;
}

/** `count` items evenly spaced from first to last. */
function spreadOver<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  return Array.from(
    { length: count },
    (_, i) => items[Math.round((i * (items.length - 1)) / (count - 1))]
  );
}
