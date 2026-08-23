import { describe, expect, it } from 'vitest';
import type { CampaignOutFull } from '~/api/client';
import type { ExtendedLabel } from '../campaign/annotation';
import { buildImageryCatalog } from '../campaign/imagery';
import {
  makeCampaign,
  makeCollection,
  makeCustomMap,
  makeSlice,
  makeSource,
  makeTileUrl,
  makeVectorLayer,
  makeView,
  makeViz,
} from '~/features/annotation/testing/fixtures';
import type {
  FeatureLayerSpec,
  GeoFeature,
  LayerSpec,
  RasterLayerSpec,
  VectorTileLayerSpec,
} from '~/shared/map/types';
import {
  type ComposeContext,
  ANNOTATION_DELTA_LAYER_ID,
  ANNOTATION_LAYER_ID,
  ANNOTATION_MARKER_LAYER_ID,
  ANNOTATION_TILE_MIN_ZOOM,
  annotationsVisibleAt,
  CROSSHAIR_LAYER_ID,
  EXTENT_LAYER_ID,
  TILE_SKELETON_LAYER_ID,
  composeLayers,
  type ComposeState,
} from './compose';

const LABELS: ExtendedLabel[] = [
  { id: 1, name: 'Field', color: '#00ff00', geometry_type: 'polygon' },
];

const CAMPAIGN: CampaignOutFull = makeCampaign({
  id: 42,
  basemaps: [{ id: 3, name: 'Satellite', url: 'https://tiles.test/{z}/{x}/{y}.png' }],
  custom_maps: [
    makeCustomMap({
      id: 8,
      name: 'Model output',
      status: 'ready',
      tile_url: 'https://tiler.test/custom/{z}/{x}/{y}.png?colormap_name=viridis&rescale=0,1',
      render_config: { mode: 'continuous', colormap_name: 'viridis', rescale: [0, 1] },
    }),
  ],
  vector_layers: [
    makeVectorLayer({
      id: 5,
      name: 'Parcels',
      pmtiles_url: 'pmtiles://https://tiles.test/parcels.pmtiles',
      color: '#ff8800',
    }),
  ],
  imagery_sources: [
    makeSource({
      id: 1,
      name: 'Sentinel',
      crosshair_hex6: '00ffff',
      visualizations: [makeViz({ id: 11, name: 'rgb' })],
      collections: [
        makeCollection({
          id: 100,
          name: '2024',
          slices: [
            makeSlice({
              id: 1000,
              name: 'jan',
              tile_urls: [
                makeTileUrl({
                  visualization_name: 'rgb',
                  tile_url: 'https://tiler.test/slices/1000/rgb/{z}/{x}/{y}.png',
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ],
  imagery_views: [makeView({ id: 1, name: 'Default', source_ids: [1] })],
});

const CATALOG = buildImageryCatalog(CAMPAIGN);

function ctxFor(mode: 'tasks' | 'explore'): ComposeContext {
  return { catalog: CATALOG, mode };
}

function stateWith(overrides: Partial<ComposeState> = {}): ComposeState {
  return {
    address: { sourceId: 1, collectionId: 100, sliceIndex: 0, vizId: '11' },
    showBasemap: false,
    selectedBasemapId: null,
    overlay: { id: null, visible: true },
    overlayOpacity: 1,
    vector: { id: null, visible: true },
    empties: {},
    crosshair: false,
    showAnnotations: true,
    showTaskAnnotations: false,
    viewSync: true,
    annotations: { version: 1, labels: LABELS },
    ...overrides,
  };
}

const ids = (layers: LayerSpec[]) => layers.map((l) => l.id);
const kinds = (layers: LayerSpec[]) => layers.map((l) => l.kind);

describe('composeLayers - tasks mode', () => {
  it('composes the imagery raster, task extent and selected reference vector layer', () => {
    const layers = composeLayers(
      ctxFor('tasks'),
      stateWith({
        vector: { id: 5, visible: true },
        focusExtent: {
          id: 'task-7',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        },
      })
    );

    expect(ids(layers)).toContain('slice-1000-11');
    expect(ids(layers)).toContain(EXTENT_LAYER_ID);
    expect(ids(layers)).toContain('vector-5');
  });

  it('omits the extent layer when there is no task geometry', () => {
    const layers = composeLayers(ctxFor('tasks'), stateWith());
    expect(ids(layers)).not.toContain(EXTENT_LAYER_ID);
  });

  it('outlines the extent in the source’s crosshair colour', () => {
    const layers = composeLayers(
      ctxFor('tasks'),
      stateWith({
        focusExtent: { id: 'task', geometry: { type: 'Point', coordinates: [1, 2] } },
        crosshairColor: '#00ffff',
      })
    );
    const extent = layers.find((l) => l.id === EXTENT_LAYER_ID);
    expect(extent?.kind === 'features' && extent.style).toEqual({
      stroke: { color: '#00ffff', width: 2, dash: [6, 4] },
    });
  });

  it('draws the crosshair at the task point', () => {
    const layers = composeLayers(
      ctxFor('tasks'),
      stateWith({ crosshair: true, crosshairPoint: [5, 6] })
    );
    const crosshair = layers.find((l) => l.id === CROSSHAIR_LAYER_ID);
    expect(crosshair?.kind).toBe('features');
    expect(crosshair && crosshair.kind === 'features' && crosshair.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [5, 6],
    });
  });

  it('scopes raster cache state to the current task, but not in Explore', () => {
    const taskRaster = composeLayers(ctxFor('tasks'), stateWith({ crosshairPoint: [5, 6] })).find(
      (layer) => layer.kind === 'raster'
    ) as RasterLayerSpec;
    const exploreRaster = composeLayers(
      ctxFor('explore'),
      stateWith({ crosshairPoint: [5, 6] })
    ).find((layer) => layer.kind === 'raster') as RasterLayerSpec;

    expect(taskRaster.cacheScope).toBe('5:6');
    expect(exploreRaster.cacheScope).toBeUndefined();
  });
});

describe('composeLayers - explore mode', () => {
  it('composes annotation tiles and the selected vector layer', () => {
    const layers = composeLayers(
      ctxFor('explore'),
      stateWith({ vector: { id: 5, visible: true } })
    );

    expect(ids(layers)).toContain(ANNOTATION_LAYER_ID);
    expect(ids(layers)).toContain('vector-5');
  });

  it('leaves the vector layer out when it is toggled off', () => {
    const layers = composeLayers(
      ctxFor('explore'),
      stateWith({ vector: { id: 5, visible: false } })
    );
    expect(ids(layers)).not.toContain('vector-5');
  });

  it('carries editing and selection ids onto the annotation tile layer', () => {
    const layers = composeLayers(
      ctxFor('explore'),
      stateWith({
        annotations: {
          version: 3,
          labels: LABELS,
          hiddenIds: new Set([7]),
          highlightIds: new Set([8, 9]),
        },
      })
    );
    const annotations = layers.find((l) => l.id === ANNOTATION_LAYER_ID) as VectorTileLayerSpec;
    expect(annotations.hiddenFeatureIds).toEqual(new Set([7]));
    expect(annotations.highlightFeatureIds).toEqual(new Set([8, 9]));
    expect(annotations.idProperty).toBe('annotation_id');
    expect(annotations.url).toContain('v=3');
  });

  // The same override the label chips and the drawing tool paint with, so a
  // saved annotation is not a different colour from the one that drew it.
  it("paints the tiles with the annotator's own label styles", () => {
    const layers = composeLayers(
      ctxFor('explore'),
      stateWith({
        annotations: {
          version: 1,
          labels: LABELS,
          labelStyles: { 1: { fillColor: '#ff0000', strokeColor: '#ff0000' } },
        },
      })
    );
    const annotations = layers.find((l) => l.id === ANNOTATION_LAYER_ID) as VectorTileLayerSpec;
    const style =
      typeof annotations.style === 'function' ? annotations.style({ label_id: 1 }) : null;

    expect(style?.stroke?.color).toContain('255,0,0');
  });

  it('leaves task-made annotations out of the tile url by default', () => {
    const layers = composeLayers(ctxFor('explore'), stateWith());
    const annotations = layers.find((l) => l.id === ANNOTATION_LAYER_ID) as VectorTileLayerSpec;
    expect(annotations.url).toContain('include_tasks=false');
  });

  // Both variants spell the filter out, so a filtered tile and an unfiltered
  // one are different URLs and no cache can mix them.
  it('asks for task-made annotations under a different url', () => {
    const layers = composeLayers(ctxFor('explore'), stateWith({ showTaskAnnotations: true }));
    const annotations = layers.find((l) => l.id === ANNOTATION_LAYER_ID) as VectorTileLayerSpec;
    expect(annotations.url).toContain('include_tasks=true');
  });
});

describe('composeLayers - imagery selection', () => {
  it('falls back to the basemap alone when there is no address', () => {
    const layers = composeLayers(ctxFor('explore'), stateWith({ address: null }));
    expect(ids(layers)).toEqual(['basemap-3']);
  });

  it('swaps the imagery raster for the basemap when the basemap is active', () => {
    const layers = composeLayers(
      ctxFor('explore'),
      stateWith({ showBasemap: true, selectedBasemapId: 'basemap-3' })
    );
    expect(ids(layers)).toContain('basemap-3');
    expect(ids(layers)).not.toContain('slice-1000-11');
  });

  it('drops only the imagery when the address no longer exists in the catalog', () => {
    const layers = composeLayers(
      ctxFor('explore'),
      stateWith({ address: { sourceId: 99, collectionId: 99, sliceIndex: 0, vizId: '99' } })
    );
    expect(kinds(layers)).not.toContain('raster');
    expect(ids(layers)).toContain(ANNOTATION_LAYER_ID);
  });

  it('stamps a legend override onto the raster url', () => {
    const plain = composeLayers(ctxFor('explore'), stateWith());
    const overridden = composeLayers(
      ctxFor('explore'),
      stateWith({ legendOverrides: { 11: { colormap_name: 'magma', rescale: [0, 2] } } })
    );

    const urlOf = (layers: LayerSpec[]) => {
      const layer = layers.find((l) => l.id === 'slice-1000-11');
      return layer && layer.kind === 'raster' ? layer.url : '';
    };
    expect(urlOf(plain)).not.toContain('magma');
    expect(urlOf(overridden)).toContain('colormap_name=magma');
  });

  it('applies the overlay selection with its opacity', () => {
    const layers = composeLayers(
      ctxFor('explore'),
      stateWith({ overlay: { id: 8, visible: true }, overlayOpacity: 0.4 })
    );
    const overlay = layers.find((l) => l.id === 'custom-map-8');
    expect(overlay?.kind).toBe('raster');
    expect(overlay && overlay.kind === 'raster' && overlay.opacity).toBe(0.4);
  });
});

// Both composition paths run through this function, so Shift+X cannot be
// honoured in one and forgotten in the other.
describe('composeLayers - showAnnotations', () => {
  it('drops annotation layers from the main map', () => {
    const layers = composeLayers(
      ctxFor('explore'),
      stateWith({
        showAnnotations: false,
        draftFeatures: [{ id: 'd', geometry: { type: 'Point', coordinates: [0, 0] } }],
      })
    );
    expect(ids(layers)).not.toContain(ANNOTATION_LAYER_ID);
    expect(ids(layers)).not.toContain('draft');
  });

  it('drops annotation layers from a window too', () => {
    const windowState = stateWith({
      target: 'window',
      address: { sourceId: 1, collectionId: 100, sliceIndex: 0, vizId: '11' },
    });

    const shown = composeLayers(ctxFor('explore'), windowState);
    expect(ids(shown)).toContain(ANNOTATION_LAYER_ID);

    const hidden = composeLayers(ctxFor('explore'), { ...windowState, showAnnotations: false });
    expect(ids(hidden)).not.toContain(ANNOTATION_LAYER_ID);
  });

  // A point task's own annotation sits exactly under the crosshair, so drawing
  // it adds a dot and nothing else - in the windows as much as on the map.
  it('keeps saved annotations out of tasks mode, windows included', () => {
    expect(ids(composeLayers(ctxFor('tasks'), stateWith()))).not.toContain(ANNOTATION_LAYER_ID);
    expect(ids(composeLayers(ctxFor('tasks'), stateWith({ target: 'window' })))).not.toContain(
      ANNOTATION_LAYER_ID
    );
  });

  it('keeps a window to its own imagery, without the main map’s reference layers', () => {
    const layers = composeLayers(
      ctxFor('explore'),
      stateWith({
        target: 'window',
        overlay: { id: 8, visible: true },
        vector: { id: 5, visible: true },
        showBasemap: true,
        selectedBasemapId: 'basemap-3',
      })
    );
    expect(ids(layers)).toContain('slice-1000-11');
    expect(ids(layers)).not.toContain('custom-map-8');
    expect(ids(layers)).not.toContain('vector-5');
    expect(ids(layers)).not.toContain('basemap-3');
  });

  // The task footprint and the crosshair say what the *page* is pointed at, so
  // a window showing another date of the same place draws them too - and the X
  // toggle reaches both maps through this one composition.
  it('draws the task footprint and the crosshair in a window', () => {
    const focused = stateWith({
      target: 'window',
      focusExtent: { id: 'task', geometry: { type: 'Point', coordinates: [1, 2] } },
      crosshair: true,
      crosshairPoint: [1, 2],
      crosshairColor: '#00ffff',
    });

    const layers = composeLayers(ctxFor('tasks'), focused);
    expect(ids(layers)).toContain(EXTENT_LAYER_ID);
    expect(ids(layers)).toContain(CROSSHAIR_LAYER_ID);

    const noCrosshair = composeLayers(ctxFor('tasks'), { ...focused, crosshair: false });
    expect(ids(noCrosshair)).toContain(EXTENT_LAYER_ID);
    expect(ids(noCrosshair)).not.toContain(CROSSHAIR_LAYER_ID);
  });
});

describe('composeLayers - tile skeleton', () => {
  it('is left out unless asked for', () => {
    expect(ids(composeLayers(ctxFor('explore'), stateWith()))).not.toContain(
      TILE_SKELETON_LAYER_ID
    );
  });

  it('sits under every other layer, including with no imagery to show', () => {
    const layers = composeLayers(ctxFor('explore'), stateWith({ tileSkeleton: true }));
    expect(ids(layers)[0]).toBe(TILE_SKELETON_LAYER_ID);
    expect((layers[0] as RasterLayerSpec).zIndex).toBeLessThan(0);

    const empty = composeLayers(
      ctxFor('explore'),
      stateWith({ tileSkeleton: true, address: null })
    );
    expect(ids(empty)).toContain(TILE_SKELETON_LAYER_ID);
  });
});

// Drawn over the tiles so a write shows up without refetching the viewport.
// The tiles are empty below the floor, so the map says why rather than looking
// like a campaign nobody has worked on.
describe('annotationsVisibleAt', () => {
  it('is false below the zoom the tiles are served from', () => {
    expect(annotationsVisibleAt(ANNOTATION_TILE_MIN_ZOOM - 0.1)).toBe(false);
  });

  it('is true from that zoom on', () => {
    expect(annotationsVisibleAt(ANNOTATION_TILE_MIN_ZOOM)).toBe(true);
    expect(annotationsVisibleAt(ANNOTATION_TILE_MIN_ZOOM + 4)).toBe(true);
  });
});

describe('composeLayers - the annotation delta', () => {
  const deltaFeature = (id: number, origin: 'local' | 'remote'): GeoFeature => ({
    id,
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { label_id: 1, origin },
  });

  const composeWithDelta = (
    features: GeoFeature[],
    ids: number[],
    extra: { hiddenIds?: Set<number>; markers?: GeoFeature[] } = {}
  ) =>
    composeLayers(
      ctxFor('explore'),
      stateWith({
        annotations: {
          version: 1,
          labels: LABELS,
          hiddenIds: extra.hiddenIds,
          delta: { features, markers: extra.markers ?? [], ids: new Set(ids) },
        },
      })
    );

  const overlayOf = (layers: LayerSpec[]) =>
    layers.find((l) => l.id === ANNOTATION_DELTA_LAYER_ID) as FeatureLayerSpec | undefined;

  const styleOf = (overlay: FeatureLayerSpec, feature: GeoFeature) =>
    typeof overlay.style === 'function' ? overlay.style(feature) : overlay.style;

  it('draws the delta and leaves those ids out of the tiles', () => {
    const layers = composeWithDelta([deltaFeature(1, 'local')], [1, 2]);

    expect(overlayOf(layers)?.features).toHaveLength(1);
    const tiles = layers.find((l) => l.id === ANNOTATION_LAYER_ID) as VectorTileLayerSpec;
    // 2 was deleted: no geometry to draw, and the tiles still have it.
    expect(tiles.hiddenFeatureIds).toEqual(new Set([1, 2]));
  });

  it('composes no overlay when nothing is outstanding', () => {
    expect(overlayOf(composeWithDelta([], []))).toBeUndefined();
  });

  // The shape itself looks like any other saved annotation - what says it is
  // new is a dot on it, in its own colour, which goes when the tiles catch up.
  it('marks another annotator’s new work with a dot rather than restyling it', () => {
    const remote = deltaFeature(2, 'remote');
    const marker: GeoFeature = {
      id: 2,
      geometry: { type: 'Point', coordinates: [1, 1] },
      properties: { label_id: 1 },
    };
    const layers = composeWithDelta([remote], [2], { markers: [marker] });

    expect(styleOf(overlayOf(layers)!, remote)?.stroke?.dash).toBeUndefined();
    const markerLayer = layers.find((l) => l.id === ANNOTATION_MARKER_LAYER_ID) as FeatureLayerSpec;
    expect(markerLayer.features).toHaveLength(1);
    expect(styleOf(markerLayer, marker)?.circle?.fill?.color).toBe(LABELS[0].color);
  });

  it('composes no marker layer when nothing new has arrived', () => {
    const layers = composeWithDelta([deltaFeature(1, 'local')], [1]);
    expect(layers.find((l) => l.id === ANNOTATION_MARKER_LAYER_ID)).toBeUndefined();
  });

  it('leaves the shape under an open edit to the edit interaction', () => {
    const layers = composeWithDelta([deltaFeature(1, 'local')], [1], { hiddenIds: new Set([1]) });

    expect(overlayOf(layers)).toBeUndefined();
  });
});
