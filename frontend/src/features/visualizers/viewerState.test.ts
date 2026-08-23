import { describe, expect, it } from 'vitest';
import type { VisualizerImageryOut, VisualizerStepOut, VisualizerViewOut } from '~/api/client';
import { composeLayers, initialState, selectSource } from './viewerState';

const step = (id: number, start: string, end: string, viz = 'True Color'): VisualizerStepOut => ({
  slice_id: id,
  label: start,
  start_date: start,
  end_date: end,
  tiles: { [viz]: { url: `https://tiles/${id}/{z}/{x}/{y}`, provider: 'mpc' } },
});

const source = (over: Partial<VisualizerImageryOut> = {}): VisualizerImageryOut => ({
  source_id: 1,
  campaign_id: 7,
  name: 'Sentinel-2',
  visualizations: ['True Color'],
  default_zoom: 15,
  max_native_zoom: null,
  has_api_key: false,
  steps: [step(1, '2024-01-01', '2024-01-07'), step(2, '2024-06-01', '2024-06-07')],
  ...over,
});

const view = (over: Partial<VisualizerViewOut> = {}): VisualizerViewOut => ({
  id: 1,
  slug: 'abc123',
  name: 'Yield',
  description: null,
  is_public: true,
  project_id: 2,
  project_name: 'Harvest',
  camera: null,
  imagery: [source()],
  overlays: [],
  can_edit: false,
  ...over,
});

describe('initialState', () => {
  it('opens on the newest date of the first source', () => {
    expect(initialState(view()).stepIndex).toBe(1);
  });

  it('seeds overlays from how the visualizer was published', () => {
    const published = view({
      overlays: [
        {
          kind: 'vector',
          id: 5,
          name: 'Fields',
          visible: false,
          opacity: 0.5,
          pmtiles_url: 'pmtiles://fields',
          source_layer: null,
          color: '#ff0000',
        },
      ],
    });
    expect(initialState(published).overlays[5]).toEqual({ visible: false, opacity: 0.5 });
  });
});

describe('selectSource', () => {
  const landsat = source({
    source_id: 2,
    name: 'Landsat',
    visualizations: ['Natural'],
    steps: [
      step(10, '2023-12-20', '2023-12-27', 'Natural'),
      step(11, '2024-01-05', '2024-01-12', 'Natural'),
      step(12, '2024-09-01', '2024-09-08', 'Natural'),
    ],
  });
  const both = view({ imagery: [source(), landsat] });

  it('keeps the viewer at the same date rather than the same index', () => {
    const start = { ...initialState(both), stepIndex: 0 };
    expect(selectSource(both, start, 2).stepIndex).toBe(1);
  });

  it('falls back to the new source first visualization when it has no match', () => {
    const next = selectSource(both, initialState(both), 2);
    expect(next.visualization).toBe('Natural');
  });
});

describe('composeLayers', () => {
  it('draws the basemap under the imagery', () => {
    const layers = composeLayers(view(), initialState(view()));
    expect(layers.map((l) => l.id)).toEqual(['basemap-dark', 'slice-2-True Color']);
  });

  it('leaves out an overlay the viewer has hidden', () => {
    const withOverlay = view({
      overlays: [
        {
          kind: 'raster',
          id: 9,
          name: 'Prediction',
          visible: true,
          opacity: 0.8,
          campaign_id: 7,
          tile_url: 'https://tiler/{z}/{x}/{y}.png',
          render_config: { mode: 'continuous', colormap_name: 'viridis', rescale: [0, 1] },
          max_native_zoom: null,
          status: 'ready',
          mlops_url: null,
        },
      ],
    });
    const shown = initialState(withOverlay);
    expect(composeLayers(withOverlay, shown).some((l) => l.id === 'overlay-9')).toBe(true);

    const hidden = { ...shown, overlays: { 9: { visible: false, opacity: 0.8 } } };
    expect(composeLayers(withOverlay, hidden).some((l) => l.id === 'overlay-9')).toBe(false);
  });

  it('routes a key-protected template through the backend proxy', () => {
    const keyed = view({
      imagery: [
        source({
          has_api_key: true,
          steps: [
            {
              ...step(3, '2024-01-01', '2024-01-31'),
              tiles: {
                'True Color': { url: 'https://p/{z}/{x}/{y}?key={api_key}', provider: null },
              },
            },
          ],
        }),
      ],
    });
    const layers = composeLayers(keyed, initialState(keyed));
    const imagery = layers.find((l) => l.id.startsWith('slice-'));
    expect(imagery).toMatchObject({
      url: expect.stringContaining('/api/7/imagery/slices/3/tiles/True%20Color/{z}/{x}/{y}'),
      auth: 'cookie',
    });
  });
});
