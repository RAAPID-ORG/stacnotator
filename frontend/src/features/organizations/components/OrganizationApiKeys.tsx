import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type OrganizationApiKeyOut } from '~/api/client';
import {
  createOrganizationApiKeyMutation,
  deleteOrganizationApiKeyMutation,
  listOrganizationApiKeysOptions,
  listOrganizationApiKeysQueryKey,
  rotateOrganizationApiKeyMutation,
} from '~/api/queries';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Button, Field, Input } from '~/shared/ui/forms';
import { ReadOnlyKeyConsent } from '~/shared/ui/ReadOnlyKeyConsent';

export type OrganizationApiKeysProps = {
  organizationId: number;
};

const NO_KEYS: OrganizationApiKeyOut[] = [];

/** Planet is the provider most of these keys are for, so its host is the example. */
const TILE_HOST_PLACEHOLDER = 'tiles.planet.com';

/** Provider keys the org's campaigns can share. The secret is write-only: it
 *  goes to the backend encrypted at rest and is never read back, so a key can
 *  be replaced but never displayed. */
export const OrganizationApiKeys = ({ organizationId }: OrganizationApiKeysProps) => {
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const queryClient = useQueryClient();
  const path = { organization_id: organizationId };

  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [host, setHost] = useState('');
  const [readOnlyConfirmed, setReadOnlyConfirmed] = useState(false);
  const [rotatingId, setRotatingId] = useState<number | null>(null);
  const [rotateValue, setRotateValue] = useState('');
  const [rotateHost, setRotateHost] = useState('');
  const [rotateConfirmed, setRotateConfirmed] = useState(false);

  const { data } = useQuery({
    ...listOrganizationApiKeysOptions({ path }),
    meta: { errorMessage: 'Failed to load API keys' },
  });
  const keys = data?.items ?? NO_KEYS;

  const refetchKeys = () =>
    queryClient.invalidateQueries({ queryKey: listOrganizationApiKeysQueryKey({ path }) });

  const create = useMutation({
    ...createOrganizationApiKeyMutation(),
    meta: { errorMessage: 'Failed to add key' },
    onSuccess: () => {
      void refetchKeys();
      setName('');
      setValue('');
      setHost('');
      setReadOnlyConfirmed(false);
    },
  });
  const rotateKey = useMutation({
    ...rotateOrganizationApiKeyMutation(),
    meta: { errorMessage: 'Failed to replace key' },
    onSuccess: () => {
      void refetchKeys();
      setRotatingId(null);
      setRotateValue('');
      setRotateHost('');
      setRotateConfirmed(false);
    },
  });
  const removeKey = useMutation({
    ...deleteOrganizationApiKeyMutation(),
    meta: { errorMessage: 'Failed to delete key' },
    onSuccess: refetchKeys,
  });

  const busy = create.isPending || rotateKey.isPending || removeKey.isPending;

  const add = () =>
    create.mutate({
      path,
      body: { name: name.trim(), value: value.trim(), allowed_tile_host: host.trim() },
    });

  const rotate = (key: OrganizationApiKeyOut) =>
    rotateKey.mutate({
      path: { ...path, key_id: key.id },
      body: { value: rotateValue.trim(), allowed_tile_host: rotateHost.trim() || null },
    });

  const remove = async (key: OrganizationApiKeyOut) => {
    const confirmed = await showConfirmDialog({
      title: `Delete ${key.name}?`,
      description: 'Imagery using this key stops loading tiles until another key is set.',
      confirmText: 'Delete',
      isDangerous: true,
    });
    if (!confirmed) return;
    removeKey.mutate({ path: { ...path, key_id: key.id } });
  };

  return (
    <section className="surface surface-section" data-testid="org-api-keys">
      <h2 className="section-heading">Provider API keys</h2>
      <p className="section-description">
        Provider keys shared across this organization. Store one here and any campaign can use it
        without seeing the secret; replacing it here updates every campaign at once. Each key is
        tied to the provider host it belongs to and is never sent anywhere else.
      </p>

      {keys.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-100 border border-neutral-200 rounded-xl bg-white">
          {keys.map((key) => (
            <li key={key.id} data-testid="org-api-key-row" className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <span className="flex-1 min-w-0 text-sm text-neutral-900 truncate">{key.name}</span>
                {key.allowed_tile_host ? (
                  <span className="text-[11px] font-mono text-neutral-500 shrink-0 truncate">
                    {key.allowed_tile_host}
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-700 shrink-0">
                    No tile host - not usable yet
                  </span>
                )}
                <span className="text-[11px] text-neutral-500 shrink-0">
                  added {new Date(key.created_at).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setRotatingId(rotatingId === key.id ? null : key.id);
                    setRotateValue('');
                    setRotateHost(key.allowed_tile_host ?? '');
                    setRotateConfirmed(false);
                  }}
                  className="inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md text-neutral-700 hover:bg-neutral-100"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => remove(key)}
                  disabled={busy}
                  className="inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md text-red-600 hover:bg-red-50 disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
              {rotatingId === key.id && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Input
                      size="sm"
                      type="password"
                      autoComplete="off"
                      value={rotateValue}
                      onChange={(e) => setRotateValue(e.target.value)}
                      placeholder="New key value"
                      className="!w-64 text-[11px] font-mono"
                    />
                    <Input
                      size="sm"
                      value={rotateHost}
                      onChange={(e) => setRotateHost(e.target.value)}
                      placeholder={TILE_HOST_PLACEHOLDER}
                      aria-label="Tile host"
                      className="!w-48 text-[11px] font-mono"
                    />
                    <Button
                      size="sm"
                      onClick={() => rotate(key)}
                      disabled={
                        busy || !rotateValue.trim() || !rotateHost.trim() || !rotateConfirmed
                      }
                    >
                      Save
                    </Button>
                  </div>
                  <ReadOnlyKeyConsent confirmed={rotateConfirmed} onChange={setRotateConfirmed} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 max-w-xl space-y-2">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Name" htmlFor="org-key-name">
            <Input
              id="org-key-name"
              size="sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Planet production"
              disabled={busy}
            />
          </Field>
          <Field label="Key" htmlFor="org-key-value">
            <Input
              id="org-key-value"
              size="sm"
              type="password"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste provider key"
              className="font-mono"
              disabled={busy}
            />
          </Field>
          <Field label="Tile host" htmlFor="org-key-host">
            <Input
              id="org-key-host"
              size="sm"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder={TILE_HOST_PLACEHOLDER}
              className="font-mono"
              disabled={busy}
            />
          </Field>
          <Button
            onClick={add}
            disabled={busy || !name.trim() || !value.trim() || !host.trim() || !readOnlyConfirmed}
          >
            Add key
          </Button>
        </div>
        <p className="text-[11px] text-neutral-500 leading-snug">
          The tile host is the provider address this key belongs to -{' '}
          <span className="font-mono">{TILE_HOST_PLACEHOLDER}</span> for Planet basemaps and scenes,
          the host in your provider&apos;s tile URL otherwise (its subdomains count too). The server
          sends this key there and refuses everywhere else, so a campaign pointing its imagery at
          some other address cannot use the key to get it delivered there.
        </p>
        <ReadOnlyKeyConsent confirmed={readOnlyConfirmed} onChange={setReadOnlyConfirmed} />
      </div>
    </section>
  );
};
