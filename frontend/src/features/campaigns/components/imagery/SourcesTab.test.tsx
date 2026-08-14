import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ImageryController } from './controller';
import { SourcesTab } from './SourcesTab';
import type { ImagerySource } from './types';

const source = (id: string, name: string, patch: Partial<ImagerySource>): ImagerySource => ({
  id,
  name,
  crosshairHex6: 'ff0000',
  defaultZoom: 15,
  visualizations: [{ name: 'RGB' }],
  generationSeries: [],
  collections: [],
  ...patch,
});

const controllerWith = (sources: ImagerySource[], campaignId?: number) =>
  ({
    state: { sources, basemaps: [] },
    campaignBbox: null,
    mode: campaignId == null ? 'draft' : 'persisted',
    pending: false,
    campaignId,
    projectId: 1,
    isDirty: false,
    save: vi.fn(),
    discard: vi.fn(),
    addSource: vi.fn(),
    updateSource: vi.fn(),
    removeSource: vi.fn(),
    addCollection: vi.fn(),
    updateCollection: vi.fn(),
    removeCollection: vi.fn(),
    refreshCollection: vi.fn(),
    refreshSource: vi.fn(),
    setBasemaps: vi.fn(),
  }) satisfies ImageryController;

describe('SourcesTab registration progress', () => {
  it('shows how far each saved source has got, with the percentage only while incomplete', () => {
    const controller = controllerWith(
      [
        source('1', 'Partial', { sliceCount: 8, registeredSliceCount: 2 }),
        source('2', 'Done', { sliceCount: 4, registeredSliceCount: 4 }),
      ],
      42
    );

    render(<SourcesTab controller={controller} onEditSource={() => {}} />);

    const bars = screen.getAllByTestId('source-registration-progress');
    expect(bars.map((b) => [b.dataset.registered, b.dataset.total])).toEqual([
      ['2', '8'],
      ['4', '4'],
    ]);
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.queryByText('100%')).toBeNull();
    expect(bars[1].querySelector('svg')).toBeTruthy();
  });

  it('stays quiet for sources that have nothing to register yet', () => {
    const drafted = controllerWith([source('new-source', 'Draft', { sliceCount: 3 })], 42);
    render(<SourcesTab controller={drafted} onEditSource={() => {}} />);

    expect(screen.queryByTestId('source-registration-progress')).toBeNull();
  });
});
