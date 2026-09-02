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
import {
  forgetSpeculative,
  resetScenes,
  useScenesStore,
  wantScenes,
  wantSliceLayers,
} from './scenes';

vi.mock('~/api/client/sdk.gen', async (original) => ({
  ...(await original<typeof import('~/api/client/sdk.gen')>()),
  searchPlanetScenes: vi.fn(),
  mintPlanetSceneLayers: vi.fn(),
}));

import { mintPlanetSceneLayers, searchPlanetScenes } from '~/api/client';

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
    collections: [
      makeCollection({
        id: 10,
        slices: [
          makeSlice({ id: 1000, tile_urls: [] }),
          ...DATE_IDS.map((id) => makeSlice({ id, tile_urls: [] })),
        ],
      }),
    ],
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

/** Enough dates to need more than one batch of mints, which is what lets a test see
 *  the date being opened overtake the fill behind it. */
const DATE_IDS = Array.from({ length: 20 }, (_, i) => 1001 + i);

/** What a search answers: the window's cover is minted, the dates inside it are only
 *  reported as holding imagery. */
const found: PlanetSceneSliceOut[] = [
  { slice_id: 1000, scene_count: 4, layer_id: 'abc' },
  ...DATE_IDS.map((id) => ({ slice_id: id, scene_count: 2, layer_id: null })),
];
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

  it('draws the covers it minted and reports the rest as dates worth stepping to', async () => {
    wantScenes(source, CAMPAIGN_ID, [-1, -1, 1, 1], true);
    calls[0].answer(found);
    await flush();

    const catalog = useCampaignStore.getState().catalog!;
    expect(catalog.slices.get(1000)!.tile_urls).toHaveLength(1);
    expect(catalog.slices.get(1001)!.tile_urls).toEqual([]);
    // Steppable all the same: the layer for a date follows behind the search.
    expect(catalog.sceneSlices.has(1001)).toBe(true);
  });
});

describe('the layers for the dates a search found', () => {
  let source: ImagerySourceOut;

  interface Mint {
    bbox: number[];
    sliceIds: number[];
    answer: () => void;
  }

  let mints: Mint[];

  /** Mints that only finish when the test says so, which is how one can be caught in
   *  flight while the queue behind it is reordered. */
  function deferMints(): void {
    mints = [];
    vi.mocked(mintPlanetSceneLayers).mockImplementation(((options: {
      body: { bbox: number[]; slice_ids: number[] };
      signal: AbortSignal;
    }) => {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        mints.push({
          bbox: options.body.bbox,
          sliceIds: options.body.slice_ids,
          answer: () =>
            resolve({
              data: {
                slices: options.body.slice_ids.map((id) => ({
                  slice_id: id,
                  scene_count: 2,
                  layer_id: `layer-${id}`,
                })),
                errors: [],
              },
            }),
        });
      });
    }) as unknown as typeof mintPlanetSceneLayers);
  }

  beforeEach(() => {
    resetScenes();
    deferSearches();
    deferMints();
    source = seedCampaign();
  });

  const search = async (view: number[], show: boolean) => {
    wantScenes(source, CAMPAIGN_ID, view as Parameters<typeof wantScenes>[2], show);
    calls[calls.length - 1].answer(found);
    await flush();
  };

  it('fills in the dates the search left, a batch at a time, over the same extent', async () => {
    await search([-1, -1, 1, 1], true);

    // The cover came back drawable; the rest are asked for behind it, never all at once.
    expect(mints).toHaveLength(1);
    expect(mints[0].bbox).toEqual(searchBox([-1, -1, 1, 1]));
    expect(mints[0].sliceIds.length).toBeLessThan(DATE_IDS.length);

    mints[0].answer();
    await flush();

    const catalog = useCampaignStore.getState().catalog!;
    for (const id of mints[0].sliceIds) {
      expect(catalog.slices.get(id)!.tile_urls[0].tile_url).toContain(`layer-${id}`);
    }
    // ...and the next batch is already on its way.
    expect(mints).toHaveLength(2);
  });

  it('puts the date being opened in front of the fill', async () => {
    await search([-1, -1, 1, 1], true);
    const last = DATE_IDS[DATE_IDS.length - 1];
    expect(mints[0].sliceIds).not.toContain(last);

    wantSliceLayers(source, CAMPAIGN_ID, [last]);
    mints[0].answer();
    await flush();

    // Its whole batch is promoted - one request either way - and it is in it.
    expect(mints[1].sliceIds).toContain(last);
  });

  it('asks for a date once, however often it is on screen', async () => {
    await search([-1, -1, 1, 1], true);
    const last = DATE_IDS[DATE_IDS.length - 1];

    wantSliceLayers(source, CAMPAIGN_ID, [last]);
    wantSliceLayers(source, CAMPAIGN_ID, [last]);
    mints[0].answer();
    await flush();
    mints[1].answer();
    await flush();

    expect(mints.filter((mint) => mint.sliceIds.includes(last))).toHaveLength(1);
  });

  it('fills a view searched ahead of time, so arriving at it draws every date', async () => {
    await search([10, 10, 11, 11], false);

    while (mints.some((mint) => mint.sliceIds.length > 0)) {
      const pending = mints.length;
      mints[mints.length - 1].answer();
      await flush();
      if (mints.length === pending) break;
    }
    const requests = mints.length;
    // Nothing is drawn while it is only being prepared.
    expect(useCampaignStore.getState().catalog!.slices.get(1001)!.tile_urls).toEqual([]);

    wantScenes(source, CAMPAIGN_ID, [10.4, 10.4, 10.6, 10.6], true);
    await flush();

    const catalog = useCampaignStore.getState().catalog!;
    for (const id of DATE_IDS) {
      expect(catalog.slices.get(id)!.tile_urls[0].tile_url).toContain(`layer-${id}`);
    }
    expect(mints).toHaveLength(requests);
  });

  it('drops the fill for views that are no longer coming up', async () => {
    await search([10, 10, 11, 11], false);
    forgetSpeculative();

    mints[0].answer();
    await flush();

    // The batch in flight finishes; nothing behind it is asked for.
    expect(mints).toHaveLength(1);
  });
});
