import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ImageryController } from './controller';
import { ImagerySetup } from './ImagerySetup';

vi.mock('./SourcesTab', () => ({ SourcesTab: () => null }));
vi.mock('./BasemapList', () => ({ BasemapList: () => null }));
vi.mock('../CustomMapsEditor', () => ({
  CustomMapsEditor: ({ ownerId }: { ownerId: number }) => (
    <div data-testid="raster-editor" data-owner={ownerId} />
  ),
}));
vi.mock('../VectorLayersEditor', () => ({
  VectorLayersEditor: ({ ownerId }: { ownerId: number }) => (
    <div data-testid="vector-editor" data-owner={ownerId} />
  ),
}));

const controller = (campaignId?: number): ImageryController => ({
  state: { sources: [], basemaps: [] },
  campaignBbox: null,
  mode: campaignId == null ? 'draft' : 'persisted',
  pending: false,
  campaignId,
  projectId: 1,
  allowsPrivateCatalogs: true,
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
});

describe('ImagerySetup overlays', () => {
  it('shows disabled overlay actions during campaign creation without mounting persisted editors', async () => {
    const draft = controller();
    render(<ImagerySetup controller={draft} />);
    expect(screen.getByRole('heading', { name: 'Overlays' })).toBeTruthy();
    expect(screen.getByText(/Overlays are available after campaign creation/)).toBeTruthy();
    for (const name of ['+ Add raster layer', '+ Add vector layer']) {
      const button = screen.getByRole('button', { name });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      await userEvent.click(button);
    }
    expect(screen.queryByTestId('raster-editor')).toBeNull();
    expect(screen.queryByTestId('vector-editor')).toBeNull();
    expect(draft.updateSource).not.toHaveBeenCalled();
  });

  it('mounts the actual overlay editors for a saved campaign', () => {
    render(<ImagerySetup controller={controller(4)} />);
    expect(screen.getByTestId('raster-editor').dataset.owner).toBe('4');
    expect(screen.getByTestId('vector-editor').dataset.owner).toBe('4');
    expect(screen.queryByText(/Overlays are available after campaign creation/)).toBeNull();
  });
});
