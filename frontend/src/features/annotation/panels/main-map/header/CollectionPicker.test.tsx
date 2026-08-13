import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCatalog } from '~/features/annotation/core/catalog';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeViz,
} from '~/features/annotation/core/catalog/testHelpers';
import { useImageryStore, usePrefsStore, useSessionStore } from '~/features/annotation/stores';
import { CollectionPicker } from './CollectionPicker';

const source = makeSource({
  id: 7,
  visualizations: [makeViz({ id: 70, name: 'rgb' })],
  collections: [
    makeCollection({ id: 71, name: 'Spring', slices: [makeSlice({ id: 710 })] }),
    makeCollection({ id: 72, name: 'Summer', slices: [makeSlice({ id: 720 })] }),
  ],
});
const catalog = buildCatalog(makeCampaign({ imagery_sources: [source] }));

beforeEach(() => {
  usePrefsStore.setState({ pinnedStart: {} });
  useSessionStore.setState({ selectedViewId: 9, taskStartCollectionId: 71 });
  useImageryStore.setState({
    address: { sourceId: 7, collectionId: 71, sliceIndex: 0, vizId: '70' },
  });
});

describe('CollectionPicker task start', () => {
  it('shows the default start collection as starred before a preference is saved', () => {
    render(<CollectionPicker catalog={catalog} sourceIds={[7]} isTaskMode title="Collections" />);

    fireEvent.click(screen.getByTitle('Collections'));

    const stars = screen.getAllByRole('button', { name: /collection first/i });
    expect(stars.filter((star) => star.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('moves the single start marker and persists that choice', () => {
    render(<CollectionPicker catalog={catalog} sourceIds={[7]} isTaskMode title="Collections" />);
    fireEvent.click(screen.getByTitle('Collections'));

    const stars = screen.getAllByRole('button', { name: /collection first/i });
    fireEvent.click(stars[1]);

    expect(useSessionStore.getState().taskStartCollectionId).toBe(72);
    expect(usePrefsStore.getState().pinnedStart).toEqual({ 9: 72 });
  });
});
