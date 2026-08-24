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

const NONE: OrganizationApiKeyOut[] = [];

/** Provider keys the org's campaigns can share. The secret is write-only: it
 *  goes to the backend encrypted at rest and is never read back, so a key can
 *  be replaced but never displayed. */
export const OrganizationApiKeys = ({ organizationId }: OrganizationApiKeysProps) => {
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const queryClient = useQueryClient();
  const path = { organization_id: organizationId };

  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [readOnlyConfirmed, setReadOnlyConfirmed] = useState(false);
  const [rotatingId, setRotatingId] = useState<number | null>(null);
  const [rotateValue, setRotateValue] = useState('');
  const [rotateConfirmed, setRotateConfirmed] = useState(false);

  const { data } = useQuery({
    ...listOrganizationApiKeysOptions({ path }),
    meta: { errorMessage: 'Failed to load API keys' },
  });
  const keys = data?.items ?? NONE;

  const refetchKeys = () =>
    queryClient.invalidateQueries({ queryKey: listOrganizationApiKeysQueryKey({ path }) });

  const create = useMutation({
    ...createOrganizationApiKeyMutation(),
    meta: { errorMessage: 'Failed to add key' },
    onSuccess: () => {
      void refetchKeys();
      setName('');
      setValue('');
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
      setRotateConfirmed(false);
    },
  });
  const removeKey = useMutation({
    ...deleteOrganizationApiKeyMutation(),
    meta: { errorMessage: 'Failed to delete key' },
    onSuccess: refetchKeys,
  });

  const busy = create.isPending || rotateKey.isPending || removeKey.isPending;

  const add = () => create.mutate({ path, body: { name: name.trim(), value: value.trim() } });

  const rotate = (key: OrganizationApiKeyOut) =>
    rotateKey.mutate({
      path: { ...path, key_id: key.id },
      body: { value: rotateValue.trim() },
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
        without seeing the secret; replacing it here updates every campaign at once.
      </p>

      {keys.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-100 border border-neutral-200 rounded-xl bg-white">
          {keys.map((key) => (
            <li key={key.id} data-testid="org-api-key-row" className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <span className="flex-1 min-w-0 text-sm text-neutral-900 truncate">{key.name}</span>
                <span className="text-[11px] text-neutral-500 shrink-0">
                  added {new Date(key.created_at).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setRotatingId(rotatingId === key.id ? null : key.id);
                    setRotateValue('');
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
                    <Button
                      size="sm"
                      onClick={() => rotate(key)}
                      disabled={busy || !rotateValue.trim() || !rotateConfirmed}
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
          <Button
            onClick={add}
            disabled={busy || !name.trim() || !value.trim() || !readOnlyConfirmed}
          >
            Add key
          </Button>
        </div>
        <ReadOnlyKeyConsent confirmed={readOnlyConfirmed} onChange={setReadOnlyConfirmed} />
      </div>
    </section>
  );
};
