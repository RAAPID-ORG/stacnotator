import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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
  it('lists a private catalog with its SAS token, never through the public listing', async () => {
    open(true);
    await userEvent.type(await screen.findByPlaceholderText(/earth-search/), CATALOG);
    await userEvent.click(await screen.findByRole('radio', { name: /Private Azure container/ }));
    const load = screen.getByRole('button', { name: 'Load' });

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

  it('is not offered where imagery gets published', async () => {
    open(false);
    await screen.findByPlaceholderText(/earth-search/);
    expect(screen.queryByRole('radio', { name: /Private Azure container/ })).toBeNull();
  });
});
