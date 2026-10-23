import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['organizations', 'common']);
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
    meta: { errorMessage: t('apiKeys.loadFailed') },
  });
  const keys = data?.items ?? NO_KEYS;

  const refetchKeys = () =>
    queryClient.invalidateQueries({ queryKey: listOrganizationApiKeysQueryKey({ path }) });

  const create = useMutation({
    ...createOrganizationApiKeyMutation(),
    meta: { errorMessage: t('apiKeys.addFailed') },
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
    meta: { errorMessage: t('apiKeys.replaceFailed') },
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
    meta: { errorMessage: t('apiKeys.deleteFailed') },
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
      title: t('apiKeys.confirmDeleteTitle', { name: key.name }),
      description: t('apiKeys.confirmDeleteDescription'),
      confirmText: t('apiKeys.delete'),
      isDangerous: true,
    });
    if (!confirmed) return;
    removeKey.mutate({ path: { ...path, key_id: key.id } });
  };

  return (
    <section className="surface surface-section" data-testid="org-api-keys">
      <h2 className="section-heading">{t('apiKeys.heading')}</h2>
      <p className="section-description">{t('apiKeys.description')}</p>

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
                    {t('apiKeys.noTileHost')}
                  </span>
                )}
                <span className="text-[11px] text-neutral-500 shrink-0">
                  {t('apiKeys.added', { date: new Date(key.created_at).toLocaleDateString() })}
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
                  {t('apiKeys.replace')}
                </button>
                <button
                  type="button"
                  onClick={() => remove(key)}
                  disabled={busy}
                  className="inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md text-red-600 hover:bg-red-50 disabled:opacity-40"
                >
                  {t('apiKeys.delete')}
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
                      placeholder={t('apiKeys.newValuePlaceholder')}
                      className="!w-64 text-[11px] font-mono"
                    />
                    <Input
                      size="sm"
                      value={rotateHost}
                      onChange={(e) => setRotateHost(e.target.value)}
                      placeholder={TILE_HOST_PLACEHOLDER}
                      aria-label={t('apiKeys.tileHost')}
                      className="!w-48 text-[11px] font-mono"
                    />
                    <Button
                      size="sm"
                      onClick={() => rotate(key)}
                      disabled={
                        busy || !rotateValue.trim() || !rotateHost.trim() || !rotateConfirmed
                      }
                    >
                      {t('common:actions.save')}
                    </Button>
                  </div>
                  <ReadOnlyKeyConsent confirmed={rotateConfirmed} onChange={setRotateConfirmed} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 max-w-4xl space-y-2">
        {/* One row: a key is the three of these together, and a wrapped form reads as
            three separate things to fill in. It still wraps when there is no room. */}
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={t('apiKeys.name')}
            htmlFor="org-key-name"
            className="min-w-0 flex-1 basis-44"
          >
            <Input
              id="org-key-name"
              size="sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('apiKeys.namePlaceholder')}
              disabled={busy}
            />
          </Field>
          <Field
            label={t('apiKeys.key')}
            htmlFor="org-key-value"
            className="min-w-0 flex-1 basis-52"
          >
            <Input
              id="org-key-value"
              size="sm"
              type="password"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('apiKeys.keyPlaceholder')}
              className="font-mono"
              disabled={busy}
            />
          </Field>
          <Field
            label={t('apiKeys.tileHost')}
            htmlFor="org-key-host"
            className="min-w-0 flex-1 basis-44"
          >
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
            className="shrink-0"
            onClick={add}
            disabled={busy || !name.trim() || !value.trim() || !host.trim() || !readOnlyConfirmed}
          >
            {t('apiKeys.add')}
          </Button>
        </div>
        <p className="text-[11px] text-neutral-500 leading-snug">
          <Trans
            t={t}
            i18nKey="apiKeys.tileHostHelp"
            values={{ host: TILE_HOST_PLACEHOLDER }}
            components={{ host: <span className="font-mono" /> }}
          />
        </p>
        <ReadOnlyKeyConsent confirmed={readOnlyConfirmed} onChange={setReadOnlyConfirmed} />
      </div>
    </section>
  );
};
