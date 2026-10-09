import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/api/client/sdk.gen', async () => {
  const actual =
    await vi.importActual<typeof import('~/api/client/sdk.gen')>('~/api/client/sdk.gen');
  return {
    ...actual,
    listCatalogs: vi.fn(() => Promise.resolve({ data: [] })),
    getProjectTilers: vi.fn(() =>
      Promise.resolve({
        data: {
          tilers: [{ name: 'hosted', kind: 'hosted', allows_ingest: true, is_default: true }],
          allows_internal_storage: false,
        },
      })
    ),
    getCollections: vi.fn(() => Promise.resolve({ data: [] })),
    getPrivateCollections: vi.fn(() => Promise.resolve({ data: [] })),
  };
});

import { getCollections, getPrivateCollections } from '~/api/client/sdk.gen';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';
import { CatalogBrowser } from './CatalogBrowser';
import type { ImageryGenerationConfig } from './types';

const CATALOG = 'https://acct.blob.core.windows.net/imagery/catalog.json';
const SAS = 'sv=2024-11-04&sr=c&sp=r&se=2099-01-01T00:00:00Z&spr=https&sig=SECRET';

const open = (allowPrivateCatalogs: boolean) =>
  renderWithQuery(
    <CatalogBrowser
      projectId={3}
      onAdd={vi.fn()}
      onClose={vi.fn()}
      allowPrivateCatalogs={allowPrivateCatalogs}
    />
  );

describe('CatalogBrowser, private catalogs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists a private catalog with its SAS token, never through the public listing', async () => {
    open(true);
    const url = await screen.findByRole('textbox', { name: 'STAC catalog URL' });
    const sections = document.querySelectorAll('section');
    expect(sections[0].textContent).toContain('Any STAC catalog');
    expect(
      screen.getByText(/API endpoint or catalog.json file, including its full path/)
    ).toBeTruthy();
    const access = screen.getByRole('radiogroup', { name: 'Catalog access' });
    expect(access.compareDocumentPosition(url) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.type(url, CATALOG);
    await userEvent.click(await screen.findByRole('radio', { name: /Private Azure container/ }));
    const load = screen.getByRole('button', { name: 'Load' });
    expect(screen.getByLabelText('SAS token').getAttribute('type')).toBe('text');

    await userEvent.type(screen.getByLabelText('SAS token'), 'sv=1&sp=rw&sig=x');
    expect(screen.getByText(/read \(and optionally list\) only/)).toBeTruthy();
    expect((load as HTMLButtonElement).disabled).toBe(true);

    await userEvent.clear(screen.getByLabelText('SAS token'));
    await userEvent.type(screen.getByLabelText('SAS token'), SAS);
    expect(screen.getByText(/Read-only access, expires/)).toBeTruthy();
    await userEvent.click(load);

    await waitFor(() => expect(getPrivateCollections).toHaveBeenCalled());
    expect(vi.mocked(getPrivateCollections).mock.calls[0][0]).toMatchObject({
      query: { project_id: 3 },
      body: { catalog_url: CATALOG, storage_access: { kind: 'azure_sas', secret: SAS } },
    });
    expect(getCollections).not.toHaveBeenCalled();
  });

  it('uses public access after switching back from a private container', async () => {
    open(true);
    await userEvent.type(await screen.findByLabelText('STAC catalog URL'), CATALOG);
    await userEvent.click(screen.getByRole('radio', { name: /Private Azure container/ }));
    await userEvent.type(screen.getByLabelText('SAS token'), SAS);
    await userEvent.click(screen.getByRole('radio', { name: 'Public' }));
    expect(screen.queryByLabelText('SAS token')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    await waitFor(() => expect(getCollections).toHaveBeenCalled());
    expect(getPrivateCollections).not.toHaveBeenCalled();
  });

  it('is not offered where imagery gets published', async () => {
    open(false);
    await screen.findByPlaceholderText(/earth-search/);
    expect(screen.queryByRole('radio', { name: /Private Azure container/ })).toBeNull();
  });

  it('asks again for the SAS before reading a saved private series', async () => {
    const saved: ImageryGenerationConfig = {
      version: 1,
      catalogUrl: CATALOG,
      stacCollectionId: 'monthly',
      collectionTitle: 'Monthly',
      isMpc: false,
      hasCloudCover: false,
      tiler: 'hosted',
      startDate: '2025-01',
      endDate: '2025-12',
      collectionPeriodInterval: 1,
      collectionPeriodUnit: 'months',
      slicePeriodInterval: 1,
      slicePeriodUnit: 'months',
      coverMode: 'nth',
      coverSliceNth: 1,
      maxCloudCover: 100,
      itemSort: 'date_desc',
      coverMaxCloudCover: 100,
      coverItemSort: 'date_desc',
      visualizations: [],
      coverVisualizations: [],
    };
    renderWithQuery(
      <CatalogBrowser
        projectId={3}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        initialGeneration={saved}
        privateCatalog={{}}
      />
    );

    await userEvent.type(await screen.findByLabelText('SAS token'), SAS);
    await userEvent.click(screen.getByRole('button', { name: 'Load catalog' }));

    await waitFor(() => expect(getPrivateCollections).toHaveBeenCalled());
    expect(vi.mocked(getPrivateCollections).mock.calls.at(-1)![0]).toMatchObject({
      body: { catalog_url: CATALOG, storage_access: { kind: 'azure_sas', secret: SAS } },
    });
    expect(getCollections).not.toHaveBeenCalled();
  });
});
