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
import { isForegroundLoading } from '~/shared/map/tileLoading';
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
  // Answers nothing by default: the tests about searching are not about the fill that
  // follows one, and it must not be left calling into an unmocked promise.
  mintPlanetSceneLayers: vi.fn(() => Promise.resolve({ data: { slices: [], errors: [] } })),
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

/** Enough dates to need several batches of mints, which is what lets a test see the
 *  date being opened overtake the fill behind it. */
const DATE_IDS = Array.from({ length: 60 }, (_, i) => 1001 + i);

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
    answered: boolean;
    answer: () => void;
  }

  let mints: Mint[];

  /** Mints that only finish when the test says so, which is how the queue behind one
   *  can be caught mid-flight. */
  function deferMints(): void {
    mints = [];
    vi.mocked(mintPlanetSceneLayers).mockImplementation(((options: {
      body: { bbox: number[]; slice_ids: number[] };
      signal: AbortSignal;
    }) => {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        const mint: Mint = {
          bbox: options.body.bbox,
          sliceIds: options.body.slice_ids,
          answered: false,
          answer: () => {
            mint.answered = true;
            resolve({
              data: {
                slices: options.body.slice_ids.map((id) => ({
                  slice_id: id,
                  scene_count: 2,
                  layer_id: `layer-${id}`,
                })),
                errors: [],
              },
            });
          },
        };
        mints.push(mint);
      });
    }) as unknown as typeof mintPlanetSceneLayers);
  }

  /** Let the queue run to the end, one round of answers at a time. */
  async function answerAll(): Promise<void> {
    for (let round = 0; round < 20; round++) {
      const pending = mints.filter((mint) => !mint.answered);
      if (pending.length === 0) return;
      for (const mint of pending) mint.answer();
      await flush();
    }
  }

  const requested = () => mints.flatMap((mint) => mint.sliceIds);

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

  it('asks for every date the search left, once each, over the same extent', async () => {
    await search([-1, -1, 1, 1], true);

    // Batched, not one request per date and not one request for all of them.
    expect(mints.length).toBeGreaterThan(0);
    expect(mints.length).toBeLessThan(DATE_IDS.length);
    await answerAll();

    expect(requested().sort((a, b) => a - b)).toEqual(DATE_IDS);
    for (const mint of mints) expect(mint.bbox).toEqual(searchBox([-1, -1, 1, 1]));

    const catalog = useCampaignStore.getState().catalog!;
    for (const id of DATE_IDS) {
      expect(catalog.slices.get(id)!.tile_urls[0].tile_url).toContain(`layer-${id}`);
    }
  });

  it('sends the date being opened at once, ahead of the fill and on its own', async () => {
    await search([-1, -1, 1, 1], true);
    const started = mints.length;
    const last = DATE_IDS[DATE_IDS.length - 1];
    expect(requested()).not.toContain(last);

    wantSliceLayers(source, CAMPAIGN_ID, [last]);

    // Not behind the batch still in flight, and carrying that date alone rather than
    // the twenty-four the fill had queued it in.
    expect(mints[started].sliceIds).toEqual([last]);
    expect(mints[started - 1].answered).toBe(false);
  });

  it('asks for a date once, however often it is on screen', async () => {
    await search([-1, -1, 1, 1], true);
    const last = DATE_IDS[DATE_IDS.length - 1];

    wantSliceLayers(source, CAMPAIGN_ID, [last]);
    wantSliceLayers(source, CAMPAIGN_ID, [last]);
    await answerAll();

    expect(requested().filter((id) => id === last)).toHaveLength(1);
  });

  it('fills a view searched ahead of time, so arriving at it draws every date', async () => {
    await search([10, 10, 11, 11], false);
    await answerAll();
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

  it('stands the tile preloader aside while a date is being opened', async () => {
    await search([-1, -1, 1, 1], true);
    // The fill alone is nobody's cue to stop preloading.
    expect(isForegroundLoading()).toBe(false);

    wantSliceLayers(source, CAMPAIGN_ID, [DATE_IDS[DATE_IDS.length - 1]]);
    expect(isForegroundLoading()).toBe(true);

    await answerAll();
    expect(isForegroundLoading()).toBe(false);
  });

  it('drops the fill for views that are no longer coming up', async () => {
    await search([10, 10, 11, 11], false);
    const started = mints.length;
    forgetSpeculative();

    await answerAll();

    // What was in flight finishes; nothing behind it is asked for.
    expect(mints).toHaveLength(started);
  });
});
