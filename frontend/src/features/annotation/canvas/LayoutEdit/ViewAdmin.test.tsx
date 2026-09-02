import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampaignOutFull } from '~/api/client';
import {
  apiSuccess,
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTileUrl,
  makeView,
  makeViz,
} from '~/features/annotation/testing/fixtures';
import { buildImageryCatalog } from '../../campaign/imagery';
import { useCampaignStore } from '../../stores/campaign';
import { useImageryStore } from '../../stores/imagery';
import { useLayoutStore } from '../../stores/layout';
import { EMPTY_LAYOUT } from '../grid';
import { ViewAdmin } from './ViewAdmin';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return { ...actual, deleteImageryView: vi.fn(), updateImageryView: vi.fn() };
});

import { deleteImageryView, updateImageryView } from '~/api/client';

const CAMPAIGN: CampaignOutFull = makeCampaign({
  imagery_sources: [
    makeSource({
      id: 1,
      name: 'Sentinel',
      visualizations: [makeViz({ id: 10, name: 'rgb' })],
      collections: [
        makeCollection({
          id: 100,
          name: 'First',
          slices: [
            makeSlice({
              id: 1000,
              name: 'cover',
              tile_urls: [
                makeTileUrl({
                  visualization_name: 'rgb',
                  tile_url: 'https://t.test/{z}/{x}/{y}.png',
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ],
  imagery_views: [
    makeView({ id: 1, name: 'One', source_ids: [1] }),
    makeView({ id: 2, name: 'Two', source_ids: [1] }),
  ],
});

afterEach(() => {
  vi.mocked(deleteImageryView).mockReset();
  vi.mocked(updateImageryView).mockReset();
  useLayoutStore.setState({ currentLayout: EMPTY_LAYOUT, savedLayout: EMPTY_LAYOUT });
  useCampaignStore.setState({ view: null });
  useImageryStore.setState({ address: null, viewSnapshots: {} });
});

describe('deleting a view', () => {
  it('moves the session onto the next view when the deleted one was selected', async () => {
    vi.mocked(deleteImageryView).mockResolvedValue(apiSuccess(undefined));
    useCampaignStore.setState({
      campaign: CAMPAIGN,
      catalog: buildImageryCatalog(CAMPAIGN),
      view: CAMPAIGN.imagery_views.find((v) => v.id === 1) ?? null,
    });

    render(<ViewAdmin />);
    await userEvent.click(screen.getByLabelText('Delete One'));
    await userEvent.click(screen.getByText('Delete'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useCampaignStore.getState().campaign?.imagery_views).toEqual([
      makeView({ id: 2, name: 'Two', source_ids: [1] }),
    ]);
    // Nothing may still address the view that is gone: the id here, and the
    // imagery address that was resolved through it.
    expect(useCampaignStore.getState().view?.id).toBe(2);
    expect(useImageryStore.getState().address?.collectionId).toBe(100);
  });

  it('leaves the selection alone when another view is deleted', async () => {
    vi.mocked(deleteImageryView).mockResolvedValue(apiSuccess(undefined));
    useCampaignStore.setState({
      campaign: CAMPAIGN,
      catalog: buildImageryCatalog(CAMPAIGN),
      view: CAMPAIGN.imagery_views.find((v) => v.id === 1) ?? null,
    });

    render(<ViewAdmin />);
    await userEvent.click(screen.getByLabelText('Delete Two'));
    await userEvent.click(screen.getByText('Delete'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useCampaignStore.getState().view?.id).toBe(1);
  });
});

describe('toggling a source into the selected view', () => {
  // The server reconciles the stored layouts and returns them; the canvas has
  // to pick that up, or the new windows silently fall into the hidden tray.
  const TWO_SOURCES: CampaignOutFull = {
    ...CAMPAIGN,
    imagery_sources: [
      ...CAMPAIGN.imagery_sources,
      makeSource({
        id: 2,
        name: 'Landsat',
        visualizations: [makeViz({ id: 20, name: 'rgb' })],
        collections: [makeCollection({ id: 200, name: 'Second', slices: [] })],
      }),
    ],
    imagery_views: [makeView({ id: 1, name: 'One', source_ids: [1] })],
  };

  const renderWithSelectedView = () => {
    useCampaignStore.setState({
      campaign: TWO_SOURCES,
      catalog: buildImageryCatalog(TWO_SOURCES),
      view: TWO_SOURCES.imagery_views[0],
    });
    useLayoutStore.setState({
      currentLayout: {
        ...EMPTY_LAYOUT,
        windows: { 100: { i: '100', x: 0, y: 25, w: 10, h: 9 } },
      },
      savedLayout: {
        ...EMPTY_LAYOUT,
        windows: { 100: { i: '100', x: 0, y: 25, w: 10, h: 9 } },
      },
    });
    return render(<ViewAdmin />);
  };

  it('puts the new windows on the canvas instead of the hidden tray', async () => {
    vi.mocked(updateImageryView).mockResolvedValue(
      apiSuccess(
        makeView({
          id: 1,
          name: 'One',
          source_ids: [1, 2],
          default_canvas_layout: {
            id: 1,
            user_id: null,
            layout_data: [
              { i: '100', x: 0, y: 25, w: 10, h: 9 },
              { i: '200', x: 10, y: 25, w: 10, h: 9 },
            ],
          },
        })
      )
    );
    renderWithSelectedView();

    await userEvent.click(screen.getByRole('checkbox', { name: /Landsat/ }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useLayoutStore.getState().currentLayout.windows[200]).toEqual({
      i: '200',
      x: 10,
      y: 25,
      w: 10,
      h: 9,
    });
  });

  it('takes the windows of an unticked source off the canvas', async () => {
    vi.mocked(updateImageryView).mockResolvedValue(
      apiSuccess(makeView({ id: 1, name: 'One', source_ids: [] }))
    );
    renderWithSelectedView();

    await userEvent.click(screen.getByRole('checkbox', { name: /Sentinel/ }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useLayoutStore.getState().currentLayout.windows).toEqual({});
  });
});
