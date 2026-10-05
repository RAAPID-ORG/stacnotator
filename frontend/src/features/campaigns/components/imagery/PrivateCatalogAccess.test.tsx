import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ImageryController } from './controller';
import { sourceToBackend } from './draftSync';
import { PrivateCatalogAccess } from './PrivateCatalogAccess';
import type { CollectionItem, ImagerySource } from './types';

const CATALOG = 'https://acct.blob.core.windows.net/imagery/catalog.json';
const SAS = 'sv=2024-11-04&sr=c&sp=r&se=2099-01-01T00:00:00Z&spr=https&sig=SECRET';

const collection = (id: string, extra: Partial<CollectionItem['data']> = {}): CollectionItem => ({
  id,
  name: id,
  coverSliceIndex: 0,
  hasDedicatedCover: false,
  slices: [{ id: `${id}-s`, name: '', startDate: '2024-01-01', endDate: '2024-01-31' }],
  data: {
    type: 'stac_browser',
    catalogUrl: CATALOG,
    stacCollectionId: 'imagery',
    isMpc: false,
    mode: 'mosaic',
    visualizations: [
      { name: 'RGB', vizParams: { assets: ['data'], assetAsBand: false, rescale: '' } },
    ],
    vizUrls: [],
    ...extra,
  } as CollectionItem['data'],
});

const source = (collections: CollectionItem[]): ImagerySource => ({
  id: '7',
  name: 'Private',
  crosshairHex6: 'ff0000',
  defaultZoom: 15,
  visualizations: [{ name: 'RGB' }],
  generationSeries: [],
  collections,
});

const controllerFor = () =>
  ({ updateCollection: vi.fn() }) as unknown as ImageryController & {
    updateCollection: ReturnType<typeof vi.fn>;
  };

describe('PrivateCatalogAccess', () => {
  it('is absent for a source that reads no private catalog', () => {
    const { container } = render(
      <PrivateCatalogAccess source={source([collection('a')])} controller={controllerFor()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows when the token expires and replaces it on every collection of the catalog', async () => {
    const access = { kind: 'azure_sas', expiresAt: '2099-01-01T00:00:00Z' };
    const src = source([
      collection('a', { storageAccess: access }),
      collection('b', { storageAccess: access }),
    ]);
    const controller = controllerFor();
    render(<PrivateCatalogAccess source={src} controller={controller} />);

    expect(screen.getByText(/Current token expires/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('SAS token'), SAS);

    const patched = controller.updateCollection.mock.calls.slice(-2);
    expect(patched.map(([, id]) => id)).toEqual(['a', 'b']);
    expect(patched.every(([, , patch]) => patch.data.sasToken === SAS)).toBe(true);
  });
});

describe('the save payload', () => {
  it('sends a typed token once and leaves a saved one alone', () => {
    const typed = sourceToBackend(source([collection('a', { sasToken: SAS })]));
    expect(typed.collections[0].stac_config?.storage_access).toEqual({
      kind: 'azure_sas',
      secret: SAS,
    });

    const saved = sourceToBackend(
      source([collection('a', { storageAccess: { kind: 'azure_sas', expiresAt: null } })])
    );
    expect(saved.collections[0].stac_config?.storage_access).toBeNull();
  });
});
