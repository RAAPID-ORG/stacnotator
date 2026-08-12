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
} from '~/features/annotation/core/catalog/testHelpers';
import { useImageryStore, useSessionStore } from '~/features/annotation/stores';
import { ViewAdmin } from './ViewAdmin';

vi.mock('~/api/client', async () => {
  const actual = await vi.importActual<typeof import('~/api/client')>('~/api/client');
  return { ...actual, deleteImageryView: vi.fn() };
});

import { deleteImageryView } from '~/api/client';

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
  useSessionStore.setState({ selectedViewId: null });
  useImageryStore.setState({ address: null, viewSnapshots: {} });
});

describe('deleting a view', () => {
  it('moves the session onto the next view when the deleted one was selected', async () => {
    vi.mocked(deleteImageryView).mockResolvedValue(apiSuccess(undefined));
    useSessionStore.setState({ selectedViewId: 1 });
    const onCampaignChange = vi.fn();

    render(<ViewAdmin campaign={CAMPAIGN} onCampaignChange={onCampaignChange} />);
    await userEvent.click(screen.getByLabelText('Delete One'));
    await userEvent.click(screen.getByText('Delete'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onCampaignChange).toHaveBeenCalledWith(
      expect.objectContaining({
        imagery_views: [makeView({ id: 2, name: 'Two', source_ids: [1] })],
      })
    );
    // Nothing may still address the view that is gone: the id here, and the
    // imagery address that was resolved through it.
    expect(useSessionStore.getState().selectedViewId).toBe(2);
    expect(useImageryStore.getState().address?.collectionId).toBe(100);
  });

  it('leaves the selection alone when another view is deleted', async () => {
    vi.mocked(deleteImageryView).mockResolvedValue(apiSuccess(undefined));
    useSessionStore.setState({ selectedViewId: 1 });

    render(<ViewAdmin campaign={CAMPAIGN} onCampaignChange={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Delete Two'));
    await userEvent.click(screen.getByText('Delete'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useSessionStore.getState().selectedViewId).toBe(1);
  });
});
