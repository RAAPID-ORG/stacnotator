import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImagerySourceOut, PlanetSceneSliceOut } from '~/api/client';
import { buildImageryCatalog } from '../campaign/imagery';
import { searchBox } from '../campaign/scenes';
import {
  makeCampaign,
  makeCollection,
  makeSceneSeries,
  makeSlice,
  makeSource,
  makeView,
  makeViz,
} from '../testing/fixtures';
import { useCampaignStore } from './campaign';
import { resetScenes, useScenesStore, wantScenes } from './scenes';

vi.mock('~/api/client/sdk.gen', async (original) => ({
  ...(await original<typeof import('~/api/client/sdk.gen')>()),
  searchPlanetScenes: vi.fn(),
}));

import { searchPlanetScenes } from '~/api/client';

interface Call {
  bbox: number[];
  signal: AbortSignal;
  answer: (slices: PlanetSceneSliceOut[]) => void;
}

let calls: Call[];

/** Searches that only finish when the test says so, which is how one search can be
 *  caught still running while the next arrives. */
function deferSearches(): void {
  calls = [];
  vi.mocked(searchPlanetScenes).mockImplementation(((options: {
    body: { bbox: number[] };
    signal: AbortSignal;
  }) => {
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      calls.push({
        bbox: options.body.bbox,
        signal: options.signal,
        answer: (slices) => resolve({ data: { slices, errors: [] } }),
      });
    });
  }) as unknown as typeof searchPlanetScenes);
}

const CAMPAIGN_ID = 7;

function seedCampaign(): ImagerySourceOut {
  const source = makeSource({
    id: 1,
    visualizations: [makeViz({ id: 100, name: 'Visual' })],
    generation_series: [makeSceneSeries()],
    collections: [makeCollection({ id: 10, slices: [makeSlice({ id: 1000, tile_urls: [] })] })],
  });
  const campaign = makeCampaign({
    imagery_sources: [source],
    imagery_views: [makeView({ source_ids: [1] })],
  });
  useCampaignStore.setState({
    campaign,
    catalog: buildImageryCatalog(campaign),
    view: campaign.imagery_views[0],
  });
  return source;
}

const found: PlanetSceneSliceOut[] = [{ slice_id: 1000, scene_count: 4, layer_id: 'abc' }];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('scene searches', () => {
  let source: ImagerySourceOut;

  beforeEach(() => {
    resetScenes();
    deferSearches();
    source = seedCampaign();
  });

  it('draws what it finds, and answers a view inside it without asking again', async () => {
    wantScenes(source, CAMPAIGN_ID, [-1, -1, 1, 1], true);
    expect(calls).toHaveLength(1);
    expect(calls[0].bbox).toEqual(searchBox([-1, -1, 1, 1]));
    expect(useScenesStore.getState().loading[1]).toBe(true);

    calls[0].answer(found);
    await flush();

    const catalog = useCampaignStore.getState().catalog!;
    expect(catalog.slices.get(1000)!.tile_urls[0].tile_url).toContain('planet-layers/abc');
    expect(useScenesStore.getState().loading[1]).toBe(false);

    wantScenes(source, CAMPAIGN_ID, [-0.5, -0.5, 0.5, 0.5], true);
    expect(calls).toHaveLength(1);
    // ...and leaves the catalog alone. Rebuilding it into an equal object is what sent
    // everything watching it round the loop again.
    expect(useCampaignStore.getState().catalog).toBe(catalog);
  });

  it('searches one view at a time', async () => {
    wantScenes(source, CAMPAIGN_ID, [0, 0, 1, 1], false);
    wantScenes(source, CAMPAIGN_ID, [10, 10, 11, 11], false);
    expect(calls).toHaveLength(1);

    calls[0].answer([]);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].bbox).toEqual(searchBox([10, 10, 11, 11]));
  });

  it('lets the view the user is waiting for take the connection', async () => {
    wantScenes(source, CAMPAIGN_ID, [0, 0, 1, 1], false);
    wantScenes(source, CAMPAIGN_ID, [10, 10, 11, 11], false);

    wantScenes(source, CAMPAIGN_ID, [20, 20, 21, 21], true);
    expect(calls[0].signal.aborted).toBe(true);
    await flush();

    expect(calls[1].bbox).toEqual(searchBox([20, 20, 21, 21]));
    // The speculative search that was interrupted is not lost, only postponed.
    calls[1].answer(found);
    await flush();
    expect(calls.map((call) => call.bbox)).toContainEqual(searchBox([0, 0, 1, 1]));
  });

  it('remembers a speculative search without drawing it', async () => {
    wantScenes(source, CAMPAIGN_ID, [0, 0, 1, 1], false);
    calls[0].answer(found);
    await flush();

    expect(useCampaignStore.getState().catalog!.slices.get(1000)!.tile_urls).toEqual([]);
    // ...and the view it covers now needs no search of its own.
    wantScenes(source, CAMPAIGN_ID, [0.4, 0.4, 0.6, 0.6], true);
    expect(calls).toHaveLength(1);
    expect(useCampaignStore.getState().catalog!.slices.get(1000)!.tile_urls).toHaveLength(1);
  });
});
