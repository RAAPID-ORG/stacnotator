import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomMapOut } from '~/api/client';
import { createCustomMap, listCustomMaps, updateCustomMap } from '~/api/client/sdk.gen';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';
import { CustomMapsEditor } from './CustomMapsEditor';

const permissions = vi.hoisted(() => ({ allowsInternalStorage: true }));

vi.mock('~/shared/hooks/useProjectTilers', () => ({
  useProjectTilers: () => ({ tilers: [], ...permissions }),
}));

vi.mock('~/api/client/sdk.gen', async () => {
  const actual =
    await vi.importActual<typeof import('~/api/client/sdk.gen')>('~/api/client/sdk.gen');
  return {
    ...actual,
    listCustomMaps: vi.fn(),
    createCustomMap: vi.fn(() => Promise.resolve({ data: {} })),
    updateCustomMap: vi.fn(() => Promise.resolve({ data: {} })),
  };
});

const URL = 'https://acct.blob.core.windows.net/maps/pred.tif';
const SAS = 'sv=2024-11-04&sr=c&sp=r&se=2099-01-01T00:00:00Z&spr=https&sig=SECRET';
const pasteToken = async (value: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('SAS token'));
  await user.paste(value);
};
const MAP: CustomMapOut = {
  id: 1,
  campaign_id: 5,
  name: 'Private prediction',
  cog_url: URL,
  render_config: { mode: 'continuous', colormap_name: 'viridis', rescale: [0, 1] },
  max_native_zoom: null,
  status: 'ready',
  status_errors: null,
  tile_url: 'https://tiler/tiles/{z}/{x}/{y}',
  mosaic_id: 'search-1',
  display_order: 0,
  mlops_url: null,
  internal_storage: false,
  storage_access: { kind: 'azure_sas', expires_at: '2099-01-01T00:00:00Z' },
};

beforeEach(() => {
  vi.clearAllMocks();
  permissions.allowsInternalStorage = true;
  vi.mocked(listCustomMaps).mockResolvedValue({
    data: [],
    request: new Request('https://app.test/api/campaigns/5/custom-maps'),
    response: new Response(),
  });
});

const openCreate = async () => {
  renderWithQuery(<CustomMapsEditor ownerKind="campaign" ownerId={5} projectId={1} />);
  await userEvent.click(screen.getByRole('button', { name: '+ Add raster layer' }));
  await userEvent.type(screen.getByTestId('custom-map-name'), 'Private prediction');
  await userEvent.type(screen.getByTestId('custom-map-url'), URL);
  expect((screen.getByRole('radio', { name: 'Public URL' }) as HTMLInputElement).checked).toBe(
    true
  );
  expect(screen.queryByLabelText('SAS token')).toBeNull();
  await userEvent.click(
    screen.getByRole('radio', { name: 'Private Azure storage (own SAS token)' })
  );
};

const openEdit = async (map = MAP) => {
  vi.mocked(listCustomMaps).mockResolvedValue({
    data: [map],
    request: new Request('https://app.test/api/campaigns/5/custom-maps'),
    response: new Response(),
  });
  renderWithQuery(<CustomMapsEditor ownerKind="campaign" ownerId={5} projectId={1} />);
  await userEvent.click(await screen.findByLabelText('Edit custom map'));
};

describe('custom map private storage access', () => {
  it('requires valid read-only access and sends the token separately from the URL', async () => {
    await openCreate();
    const submit = screen.getByRole('button', { name: 'Add map' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    const input = screen.getByLabelText('SAS token');
    expect(input.getAttribute('type')).toBe('password');
    await pasteToken(SAS.replace('sp=r', 'sp=rw'));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(input);
    await pasteToken(SAS);
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    expect(
      (screen.getByRole('radio', { name: /Hosted in internal storage/ }) as HTMLInputElement)
        .checked
    ).toBe(false);
    await userEvent.click(submit);
    await waitFor(() => expect(createCustomMap).toHaveBeenCalledOnce());
    expect(vi.mocked(createCustomMap).mock.calls[0][0]?.body).toMatchObject({
      cog_url: URL,
      internal_storage: false,
      storage_access: { kind: 'azure_sas', secret: SAS },
    });
  });

  it('shows saved expiry without the secret and preserves it on unrelated edits', async () => {
    await openEdit();
    expect(screen.getByText(/Current token expires/)).toBeTruthy();
    expect((screen.getByLabelText('SAS token') as HTMLInputElement).value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Save map' }));
    await waitFor(() => expect(updateCustomMap).toHaveBeenCalledOnce());
    expect(vi.mocked(updateCustomMap).mock.calls[0][0]?.body?.storage_access).toBeUndefined();
  });

  it('replaces the saved token', async () => {
    await openEdit();
    await pasteToken(SAS);
    await userEvent.click(screen.getByRole('button', { name: 'Save map' }));
    await waitFor(() => expect(updateCustomMap).toHaveBeenCalledOnce());
    expect(vi.mocked(updateCustomMap).mock.calls[0][0]?.body?.storage_access).toEqual({
      kind: 'azure_sas',
      secret: SAS,
    });
  });

  it.each([
    { name: 'Public URL', internal: false },
    { name: /Hosted in internal storage/, internal: true },
  ])('removes saved SAS access when switching to $name', async ({ name, internal }) => {
    await openEdit();
    await userEvent.click(screen.getByRole('radio', { name }));
    expect(screen.queryByLabelText('SAS token')).toBeNull();
    expect(
      (
        screen.getByRole('radio', {
          name: 'Private Azure storage (own SAS token)',
        }) as HTMLInputElement
      ).checked
    ).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Save map' }));
    await waitFor(() => expect(updateCustomMap).toHaveBeenCalledOnce());
    expect(vi.mocked(updateCustomMap).mock.calls[0][0]?.body).toMatchObject({
      storage_access: null,
      internal_storage: internal,
    });
  });

  it('selects saved internal storage and clears it when switching to SAS access', async () => {
    await openEdit({ ...MAP, storage_access: null, internal_storage: true });
    expect(
      (screen.getByRole('radio', { name: /Hosted in internal storage/ }) as HTMLInputElement)
        .checked
    ).toBe(true);
    await userEvent.click(
      screen.getByRole('radio', { name: 'Private Azure storage (own SAS token)' })
    );
    await pasteToken(SAS);
    await userEvent.click(screen.getByRole('button', { name: 'Save map' }));
    await waitFor(() => expect(updateCustomMap).toHaveBeenCalledOnce());
    expect(vi.mocked(updateCustomMap).mock.calls[0][0]?.body).toMatchObject({
      internal_storage: false,
      storage_access: { kind: 'azure_sas', secret: SAS },
    });
  });

  it('hides internal storage when the organization does not permit it', async () => {
    permissions.allowsInternalStorage = false;
    await openCreate();
    expect(screen.queryByRole('radio', { name: /Hosted in internal storage/ })).toBeNull();
  });
});
