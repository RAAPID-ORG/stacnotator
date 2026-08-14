import { useEffect, useState } from 'react';
import {
  listCampaignOrganizationKeys,
  type ApiKeyUpdate,
  type OrganizationKeyOut,
} from '~/api/client';
import { Input, Select } from '~/shared/ui/forms';
import { handleError } from '~/shared/utils/errorHandler';

interface ApiKeyFieldProps {
  /** Absent in the create wizard - there is no campaign to scope keys to yet. */
  campaignId?: number | null;
  /** False in the create wizard (entity not saved yet) - the key can't be set until saved. */
  persisted: boolean;
  /** Whether a key is already configured server-side. */
  hasApiKey?: boolean;
  /** Set when the layer uses one of the organization's shared keys. */
  organizationApiKeyId?: number | null;
  /** Persist the choice. Resolves true on success. */
  onSave: (body: ApiKeyUpdate) => Promise<boolean>;
}

const MANUAL = 'manual';

/**
 * Where this layer's provider key comes from: one of the organization's shared
 * keys, or a value typed here. Typed values are write-only - they go straight
 * to the backend (encrypted at rest) and are never read back, so the control
 * only ever reports whether a key is configured.
 */
export const ApiKeyField = ({
  campaignId,
  persisted,
  hasApiKey,
  organizationApiKeyId,
  onSave,
}: ApiKeyFieldProps) => {
  const [value, setValue] = useState('');
  const [configured, setConfigured] = useState(!!hasApiKey);
  const [orgKeyId, setOrgKeyId] = useState<number | null>(organizationApiKeyId ?? null);
  const [orgKeys, setOrgKeys] = useState<OrganizationKeyOut[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!persisted || campaignId == null) return;
    let cancelled = false;
    void listCampaignOrganizationKeys({ path: { campaign_id: campaignId } })
      .then(({ data }) => {
        if (!cancelled) setOrgKeys(data?.items ?? []);
      })
      .catch((err) => handleError(err, 'Failed to load organization keys', { showUser: false }));
    return () => {
      cancelled = true;
    };
  }, [persisted, campaignId]);

  const explainer = (
    <p className="text-[11px] text-neutral-500 leading-snug">
      This provider needs an API key to serve its tiles. The key is encrypted on the server and used
      only to load tiles on each annotator&apos;s behalf - it is never sent to their browser, shown
      in tile links, or visible to them. You can update or replace it any time.
    </p>
  );

  if (!persisted) {
    return (
      <div className="mt-1 space-y-1">
        {explainer}
        <p className="text-[11px] text-neutral-400 italic">
          Save imagery first, then set the key here.
        </p>
      </div>
    );
  }

  const save = async (body: ApiKeyUpdate) => {
    setSaving(true);
    setError(null);
    const ok = await onSave(body);
    setSaving(false);
    if (!ok) {
      setError('Failed to save key');
      return;
    }
    setConfigured(true);
    setValue('');
  };

  const pickOrgKey = async (raw: string) => {
    if (raw === MANUAL) {
      setOrgKeyId(null);
      return;
    }
    const id = Number(raw);
    setOrgKeyId(id);
    await save({ organization_api_key_id: id });
  };

  const status = error ? (
    <span className="text-[11px] text-red-600">{error}</span>
  ) : configured ? (
    <span className="text-[11px] text-emerald-600">Key configured ✓</span>
  ) : (
    <span className="text-[11px] text-amber-600">No key set</span>
  );

  return (
    <div className="mt-1 space-y-1.5">
      {explainer}
      {orgKeys.length > 0 && (
        <div className="flex items-center gap-2">
          <Select
            size="sm"
            value={orgKeyId === null ? MANUAL : String(orgKeyId)}
            onChange={(e) => void pickOrgKey(e.target.value)}
            disabled={saving}
            className="!w-56 text-[11px]"
            aria-label="Provider key source"
            data-testid="org-key-select"
          >
            <option value={MANUAL}>Enter a key for this campaign</option>
            {orgKeys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.name} (organization)
              </option>
            ))}
          </Select>
          {orgKeyId !== null && status}
        </div>
      )}
      {orgKeyId === null && (
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={configured ? 'Replace API key' : 'Paste provider API key'}
            autoComplete="off"
            className="!w-56 text-[11px] font-mono"
          />
          <button
            type="button"
            onClick={() => void save({ value: value.trim() })}
            disabled={saving || !value.trim()}
            className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save key'}
          </button>
          {status}
        </div>
      )}
    </div>
  );
};
