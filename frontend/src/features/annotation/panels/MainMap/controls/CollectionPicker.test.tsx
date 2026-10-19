import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildImageryCatalog } from '../../../campaign/imagery';
import {
  makeCampaign,
  makeCollection,
  makeView,
  makeSlice,
  makeSource,
  makeViz,
} from '~/features/annotation/testing/fixtures';
import { useCampaignStore } from '../../../stores/campaign';
import { useImageryStore } from '../../../stores/imagery';
import { usePrefsStore } from '../../../stores/prefs';
import { useLayoutStore } from '../../../stores/layout';
import { CollectionPicker } from './CollectionPicker';

const source = makeSource({
  id: 7,
  visualizations: [makeViz({ id: 70, name: 'rgb' })],
  collections: [
    makeCollection({ id: 71, name: 'Spring', slices: [makeSlice({ id: 710 })] }),
    makeCollection({ id: 72, name: 'Summer', slices: [makeSlice({ id: 720 })] }),
  ],
});
const catalog = buildImageryCatalog(makeCampaign({ imagery_sources: [source] }));

beforeEach(() => {
  useLayoutStore.setState({ editing: false });
  usePrefsStore.setState({ pinnedStart: {} });
  useCampaignStore.setState({
    view: makeView({ id: 9, name: 'View', source_ids: [7] }),
    taskStartCollectionId: 71,
  });
  useImageryStore.setState({
    address: { sourceId: 7, collectionId: 71, sliceIndex: 0, vizId: '70' },
  });
});

describe('CollectionPicker task start', () => {
  it('can expand and collapse a detached picker even with only one collection', () => {
    useLayoutStore.setState({ editing: true });
    const single = buildImageryCatalog(
      makeCampaign({ imagery_sources: [{ ...source, collections: [source.collections[0]] }] })
    );
    const onExpandedChange = vi.fn();
    const { rerender } = render(
      <CollectionPicker
        catalog={single}
        sourceIds={[7]}
        isTaskMode
        title="Collections"
        expanded={false}
        onExpandedChange={onExpandedChange}
      />
    );
    expect(screen.queryByRole('radiogroup', { name: 'Collections' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Collections' }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);

    rerender(
      <CollectionPicker
        catalog={single}
        sourceIds={[7]}
        isTaskMode
        title="Collections"
        expanded
        onExpandedChange={onExpandedChange}
      />
    );
    expect(screen.getByRole('radio', { name: 'Spring' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Collections' }));
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });

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

    expect(useCampaignStore.getState().taskStartCollectionId).toBe(72);
    expect(usePrefsStore.getState().pinnedStart).toEqual({ 9: 72 });
  });
});
