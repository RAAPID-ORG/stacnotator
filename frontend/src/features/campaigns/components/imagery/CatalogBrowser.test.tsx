import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StacCollectionOut } from '~/api/client';

const catalogCollections = vi.hoisted(() => ({ items: [] as StacCollectionOut[] }));

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
    getCollections: vi.fn(() => Promise.resolve({ data: catalogCollections.items })),
    getPrivateCollections: vi.fn(() => Promise.resolve({ data: [] })),
  };
});

import { getCollections, getPrivateCollections } from '~/api/client/sdk.gen';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';
import { CatalogBrowser } from './CatalogBrowser';
import type { CatalogBrowserResult } from './CatalogBrowser';
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
  beforeEach(() => {
    vi.clearAllMocks();
    catalogCollections.items = [];
  });

  it('keeps the generated NDVI cover synchronized when an existing false-color tab is edited', async () => {
    catalogCollections.items = [
      {
        id: 'sentinel-2-l2a',
        title: 'Sentinel',
        description: '',
        keywords: [],
        has_cloud_cover: true,
        item_assets: Object.fromEntries(
          ['visual', 'B08', 'B04', 'B03'].map((name) => [
            name,
            { title: name, type: 'image/tiff', roles: ['data'] },
          ])
        ),
      },
    ];
    const onAdd = vi.fn<(result: CatalogBrowserResult) => void>();
    renderWithQuery(
      <CatalogBrowser
        projectId={3}
        onAdd={onAdd}
        onClose={vi.fn()}
        preset={{ stacCollectionId: 'sentinel-2-l2a', label: 'Sentinel' }}
      />
    );
    const tabs = await screen.findAllByRole('button', { name: 'False Color (Vegetation)' });
    await userEvent.click(tabs[0]);
    await userEvent.click(screen.getByRole('button', { name: 'NDVI' }));
    const name = screen.getByDisplayValue('False Color (Vegetation)');
    await userEvent.clear(name);
    await userEvent.type(name, 'NDVI');
    await userEvent.click(screen.getByRole('button', { name: /^Generate/ }));
    expect(onAdd).toHaveBeenCalledOnce();
    const result = onAdd.mock.calls[0][0];
    const data = result.collections[0].data;
    if (data.type !== 'stac_browser') throw new Error('Expected STAC imagery');
    expect(data.visualizations[1].name).toBe('NDVI');
    expect(data.visualizations[1].vizParams.expression).toBe('(B08-B04)/(B08+B04)');
    expect(data.coverVisualizations?.[1].vizParams).toEqual({
      ...data.visualizations[1].vizParams,
      compositing: 'first',
    });
    expect(result.collections[0].hasDedicatedCover).toBe(true);
  });

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

  it('guides saved mosaic series through grouping patterns and custom periods', async () => {
    const saved: ImageryGenerationConfig = {
      version: 1,
      catalogUrl: 'https://example.test/stac',
      stacCollectionId: 'imagery',
      collectionTitle: 'Imagery',
      isMpc: false,
      hasCloudCover: false,
      startDate: '2025-01',
      endDate: '2025-12',
      collectionPeriodInterval: 1,
      collectionPeriodUnit: 'months',
      slicePeriodInterval: 1,
      slicePeriodUnit: 'weeks',
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
      <CatalogBrowser projectId={3} onAdd={vi.fn()} onClose={vi.fn()} initialGeneration={saved} />
    );
    expect(await screen.findByText('Mosaic groups and time periods')).toBeTruthy();
    const pattern = screen.getByRole('combobox', { name: 'Grouping pattern' });
    expect((pattern as HTMLSelectElement).selectedOptions[0].text).toBe(
      'Group by month with weekly detailed imagery'
    );
    await userEvent.selectOptions(pattern, 'yearly-monthly');
    await userEvent.selectOptions(pattern, 'custom');
    expect((screen.getByLabelText('Group time unit') as HTMLSelectElement).value).toBe('years');
    expect((screen.getByLabelText('Detailed imagery time unit') as HTMLSelectElement).value).toBe(
      'months'
    );
    expect(screen.getByText(/Each group \(imagery collection\) spans 1 year/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Detailed imagery time unit'), 'weeks');
    expect(screen.getByText(/detailed mosaic \(slice\) every 1 week/)).toBeTruthy();
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
