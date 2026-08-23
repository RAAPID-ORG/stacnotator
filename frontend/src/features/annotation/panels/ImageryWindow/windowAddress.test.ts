import { describe, it, expect } from 'vitest';
import { buildImageryCatalog } from '../../campaign/imagery';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTileUrl,
  makeViz,
} from '../../testing/fixtures';
import { windowAddress } from './ImageryWindow';

const trueColor = makeTileUrl({ visualization_name: 'True Color' });
const falseColor = makeTileUrl({ visualization_name: 'False Color' });

const slices = (id: number) => [makeSlice({ id, tile_urls: [trueColor, falseColor] })];

const catalog = buildImageryCatalog(
  makeCampaign({
    imagery_sources: [
      makeSource({
        id: 1,
        visualizations: [
          makeViz({ id: 900, name: 'True Color' }),
          makeViz({ id: 901, name: 'False Color' }),
        ],
        collections: [
          makeCollection({ id: 10, slices: slices(100) }),
          makeCollection({ id: 12, slices: slices(120) }),
        ],
      }),
    ],
  })
);

const active = { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '901' };

describe('windowAddress', () => {
  it('shows the shared address for the active collection', () => {
    expect(windowAddress(catalog, { address: active, windowSlices: {} }, 10)).toEqual(active);
  });

  it('renders another collection the way the page is being rendered', () => {
    expect(windowAddress(catalog, { address: active, windowSlices: {} }, 12)).toEqual({
      sourceId: 1,
      collectionId: 12,
      sliceIndex: 0,
      vizId: '901',
    });
  });

  it('keeps its own remembered slice while following the visualization', () => {
    const remembered = { 12: { selected: 0, userPicked: 0 } };
    expect(windowAddress(catalog, { address: active, windowSlices: remembered }, 12)?.vizId).toBe(
      '901'
    );
  });
});
