import { describe, expect, it } from 'vitest';
import type { CampaignOutFull } from '~/api/client';
import type { ExtendedLabel } from '../campaign/annotation';
import { buildCatalog } from '../campaign/catalog';
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
import type { LayerSpec, RasterLayerSpec, VectorTileLayerSpec } from '../map/types';
import {
  type ComposeContext,
  ANNOTATION_LAYER_ID,
  CROSSHAIR_LAYER_ID,
  EXTENT_LAYER_ID,
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

const CATALOG = buildCatalog(CAMPAIGN);

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
        annotations: { version: 3, labels: LABELS, hiddenIds: [7], highlightIds: [8, 9] },
      })
    );
    const annotations = layers.find((l) => l.id === ANNOTATION_LAYER_ID) as VectorTileLayerSpec;
    expect(annotations.hiddenFeatureIds).toEqual([7]);
    expect(annotations.highlightFeatureIds).toEqual([8, 9]);
    expect(annotations.idProperty).toBe('annotation_id');
    expect(annotations.url).toContain('v=3');
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

  it('honours the toggle in a tasks-mode window, where the main map has no tiles', () => {
    const windowState = stateWith({ target: 'window' });

    expect(ids(composeLayers(ctxFor('tasks'), windowState))).toContain(ANNOTATION_LAYER_ID);
    expect(ids(composeLayers(ctxFor('tasks'), stateWith()))).not.toContain(ANNOTATION_LAYER_ID);
    expect(
      ids(composeLayers(ctxFor('tasks'), { ...windowState, showAnnotations: false }))
    ).not.toContain(ANNOTATION_LAYER_ID);
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
