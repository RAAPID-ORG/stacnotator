import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ApiKeyUpdate, type OrganizationApiKeyOut } from '~/api/client';
import { listCampaignOrganizationKeysOptions } from '~/api/queries';
import { useProject } from '~/app/projectRoute';
import { Input, Select } from '~/shared/ui/forms';
import { ReadOnlyKeyConsent } from '~/shared/ui/ReadOnlyKeyConsent';
import { SharedKeyAudience } from './SharedKeyAudience';

interface ApiKeyFieldProps {
  /** Absent in the create wizard - there is no campaign to scope keys to yet. */
  campaignId?: number | null;
  /** Owning project. Only used to say who a shared key would be spent by. */
  projectId?: number | null;
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

const NO_KEYS: OrganizationApiKeyOut[] = [];

/**
 * Where this layer's provider key comes from: one of the organization's shared
 * keys, or a value typed here. Typed values are write-only - they go straight
 * to the backend (encrypted at rest) and are never read back, so the control
 * only ever reports whether a key is configured.
 */
export const ApiKeyField = ({
  campaignId,
  projectId,
  persisted,
  hasApiKey,
  organizationApiKeyId,
  onSave,
}: ApiKeyFieldProps) => {
  const [value, setValue] = useState('');
  const [readOnlyConfirmed, setReadOnlyConfirmed] = useState(false);
  const [configured, setConfigured] = useState(!!hasApiKey);
  const [orgKeyId, setOrgKeyId] = useState<number | null>(organizationApiKeyId ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { project } = useProject(projectId ?? null);
  const projectIsPublic = project?.visibility === 'public';

  const { data: orgKeysData } = useQuery({
    ...listCampaignOrganizationKeysOptions({ path: { campaign_id: campaignId ?? 0 } }),
    enabled: persisted && campaignId != null,
    // Without the shared keys the field still takes a typed value, so a
    // failure here narrows the choice rather than breaking the form.
    meta: { errorMessage: 'Failed to load organization keys', showUser: false },
  });
  const orgKeys = orgKeysData?.items ?? NO_KEYS;

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
    setReadOnlyConfirmed(false);
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
      {orgKeyId !== null && <SharedKeyAudience projectIsPublic={projectIsPublic} />}
      {orgKeyId === null && (
        <ReadOnlyKeyConsent confirmed={readOnlyConfirmed} onChange={setReadOnlyConfirmed} />
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
            disabled={saving || !value.trim() || !readOnlyConfirmed}
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
