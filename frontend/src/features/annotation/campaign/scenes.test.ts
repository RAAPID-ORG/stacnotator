import { describe, expect, it } from 'vitest';
import {
  makeCampaign,
  makeCollection,
  makeSceneSeries,
  makeSource,
  makeView,
} from '../testing/fixtures';
import { buildImageryCatalog } from './imagery';
import { boxAround, covers, sceneSourceOf, sceneSourcesInView, searchBox } from './scenes';

const sceneSource = makeSource({
  id: 1,
  generation_series: [makeSceneSeries()],
  collections: [makeCollection({ id: 10 })],
});
const stacSource = makeSource({ id: 2, collections: [makeCollection({ id: 20 })] });

const catalog = buildImageryCatalog(makeCampaign({ imagery_sources: [sceneSource, stacSource] }));

describe('finding the scene sources', () => {
  it('picks out the source a collection belongs to, and only when it is found imagery', () => {
    expect(sceneSourceOf(catalog, sceneSource.collections[0])?.id).toBe(1);
    expect(sceneSourceOf(catalog, stacSource.collections[0])).toBeNull();
  });

  it('follows the view, so a source the page is not browsing is not searched', () => {
    expect(sceneSourcesInView(catalog, makeView({ source_ids: [1, 2] })).map((s) => s.id)).toEqual([
      1,
    ]);
    expect(sceneSourcesInView(catalog, makeView({ source_ids: [2] }))).toEqual([]);
  });
});

describe('the box a search covers', () => {
  it('reaches past the screen, keeping its centre', () => {
    expect(searchBox([-1, -1, 1, 1], 2)).toEqual([-2, -2, 2, 2]);
  });

  it('is the screen-sized box the map will show at the next task', () => {
    expect(boxAround([10, 20], [-1, -2, 1, 2])).toEqual([9, 18, 11, 22]);
  });

  it('covers a view only when it holds all of it', () => {
    expect(covers([-2, -2, 2, 2], [-1, -1, 1, 1])).toBe(true);
    expect(covers([-2, -2, 2, 2], [-1, -1, 3, 1])).toBe(false);
  });
});
