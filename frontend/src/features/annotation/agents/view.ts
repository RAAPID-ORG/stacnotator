import type { CampaignOutFull } from '~/api/client';
import { isSceneSource } from '../campaign/scenes';

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

export const DEFAULT_COLUMNS = 4;
export const DEFAULT_CELL_PX = 320;
export const DEFAULT_ZOOM = 15;
const MAX_IMAGE_PX = 2048;
const MAX_CELLS = 36;
const OVERVIEW_MAX_CELLS = 16;

/** Throws a message the agent can act on. */
export function checkView(view: ViewSpec): void {
  const columns = view.columns ?? DEFAULT_COLUMNS;
  const cellPx = view.cell_px ?? DEFAULT_CELL_PX;
  if (!view.cells?.length || view.cells.length > MAX_CELLS)
    throw new Error(`a view holds 1-${MAX_CELLS} cells`);
  if (columns < 1 || columns > 8) throw new Error('columns must be 1-8');
  if (cellPx < 96 || cellPx > 1024) throw new Error('cell_px must be 96-1024');
  if (columns * cellPx > MAX_IMAGE_PX)
    throw new Error(`columns * cell_px must be at most ${MAX_IMAGE_PX}`);
  for (const cell of view.cells) {
    const kinds = [cell.slice_id, cell.basemap_id, cell.timeseries_ids].filter((v) => v != null);
    if (kinds.length !== 1)
      throw new Error('a cell names exactly one of slice_id, basemap_id, timeseries_ids');
    if (cell.timeseries_ids == null && (cell.remove_cloudy || cell.smoothed))
      throw new Error('remove_cloudy and smoothed apply to time series cells only');
  }
}

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

/** The most recent period covers of the first source with the time series, and a basemap
 *  pair at two zooms for the surroundings. The agent asks for detail from there. */
export function defaultViews(context: CampaignContext): ViewSpec[] {
  const first = context.imagery[0];
  const zoom = first?.default_zoom ?? DEFAULT_ZOOM;
  const covers: ViewCell[] = (first?.collections ?? [])
    .flatMap((c) => (c.cover_slice_id != null ? [{ slice_id: c.cover_slice_id }] : []))
    .slice(-OVERVIEW_MAX_CELLS);
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
    views.push({ cells: [...covers, ...series], columns: Math.min(4, covers.length), zoom });
  } else if (series.length) {
    views.push({ cells: series, columns: 2, cell_px: 512, zoom });
  }
  const basemap = context.basemaps[0];
  if (basemap) {
    views.push({
      cells: [
        { basemap_id: basemap.basemap_id, zoom: Math.max(1, zoom - 3) },
        { basemap_id: basemap.basemap_id, zoom: Math.min(22, zoom + 1) },
      ],
      columns: 2,
      cell_px: 512,
      zoom,
    });
  }
  return views;
}
