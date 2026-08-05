import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationOut } from '~/api/client';

type Listing = { data: { items: OrganizationOut[] } };

const respond = vi.fn<() => Promise<Listing>>();

vi.mock('~/api/client', () => ({ listOrganizations: () => respond() }));

const { useOrganizationsStore } = await import('./organizations.store');

const org = (id: number, name: string): OrganizationOut => ({
  id,
  name,
  status: 'approved',
  allows_internal_storage: false,
});

const listing = (...items: OrganizationOut[]): Listing => ({ data: { items } });

const deferred = () => {
  let resolve: (value: Listing) => void = () => {};
  const promise = new Promise<Listing>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useOrganizationsStore', () => {
  beforeEach(() => {
    respond.mockReset();
    useOrganizationsStore.setState({ items: [], loading: true, loaded: false, inFlight: null });
  });

  it('fetches once no matter how many consumers ask', async () => {
    respond.mockResolvedValue(listing(org(1, 'Acme')));
    const { ensureLoaded } = useOrganizationsStore.getState();

    await Promise.all([ensureLoaded(), ensureLoaded()]);
    await useOrganizationsStore.getState().ensureLoaded();

    expect(respond).toHaveBeenCalledTimes(1);
    expect(useOrganizationsStore.getState().items).toEqual([org(1, 'Acme')]);
    expect(useOrganizationsStore.getState().loading).toBe(false);
  });

  it('refresh shows an organization created after the first load', async () => {
    respond.mockResolvedValue(listing(org(1, 'Acme')));
    await useOrganizationsStore.getState().ensureLoaded();

    respond.mockResolvedValue(listing(org(1, 'Acme'), org(2, 'New org')));
    await useOrganizationsStore.getState().refresh();

    expect(respond).toHaveBeenCalledTimes(2);
    expect(useOrganizationsStore.getState().items).toEqual([org(1, 'Acme'), org(2, 'New org')]);
  });

  it('queues a refresh behind an in-flight fetch so responses cannot land out of order', async () => {
    const first = deferred();
    const second = deferred();
    respond
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const loaded = useOrganizationsStore.getState().ensureLoaded();
    const refreshed = useOrganizationsStore.getState().refresh();
    await flush();
    expect(respond).toHaveBeenCalledTimes(1);

    first.resolve(listing(org(1, 'Acme')));
    await loaded;
    await flush();
    expect(respond).toHaveBeenCalledTimes(2);

    second.resolve(listing(org(1, 'Acme'), org(2, 'New org')));
    await refreshed;
    expect(useOrganizationsStore.getState().items).toEqual([org(1, 'Acme'), org(2, 'New org')]);
    expect(useOrganizationsStore.getState().inFlight).toBeNull();
  });

  it('stops loading on a failed fetch and retries on the next ensureLoaded', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    respond.mockRejectedValue(new Error('offline'));

    await useOrganizationsStore.getState().ensureLoaded();
    expect(useOrganizationsStore.getState().loading).toBe(false);
    expect(useOrganizationsStore.getState().items).toEqual([]);

    respond.mockResolvedValue(listing(org(1, 'Acme')));
    await useOrganizationsStore.getState().ensureLoaded();
    expect(respond).toHaveBeenCalledTimes(2);
    expect(useOrganizationsStore.getState().items).toEqual([org(1, 'Acme')]);

    await useOrganizationsStore.getState().ensureLoaded();
    expect(respond).toHaveBeenCalledTimes(2);

    logged.mockRestore();
  });
});
