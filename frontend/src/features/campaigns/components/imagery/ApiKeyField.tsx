import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type OrganizationApiKeyOut } from '~/api/client';
import { getProjectOrganizationKeysOptions } from '~/api/queries';
import { useProject } from '~/app/projectRoute';
import { Input, Select } from '~/shared/ui/forms';
import { ReadOnlyKeyConsent } from '~/shared/ui/ReadOnlyKeyConsent';
import { SharedKeyAudience } from './SharedKeyAudience';

export interface ProviderKeyChoice {
  organizationApiKeyId: number | null;
  /** A typed key, set only once its owner confirmed it is read-only. */
  apiKey?: string;
}

interface ApiKeyFieldProps {
  projectId: number;
  /** Whether the saved layer already has a key server-side. */
  configured?: boolean;
  organizationApiKeyId?: number | null;
  /** A typed key not saved yet. */
  apiKey?: string;
  onChange: (choice: ProviderKeyChoice) => void;
}

const MANUAL = 'manual';

const NO_KEYS: OrganizationApiKeyOut[] = [];

/**
 * Where this layer's provider key comes from: one of the organization's shared
 * keys, or a value typed here. The choice is part of the imagery being edited and
 * is saved with it. Typed values are write-only - encrypted on the server and never
 * read back - so for a saved layer the control only reports that a key exists.
 */
export const ApiKeyField = ({
  projectId,
  configured,
  organizationApiKeyId,
  apiKey,
  onChange,
}: ApiKeyFieldProps) => {
  const [value, setValue] = useState(apiKey ?? '');
  const [readOnlyConfirmed, setReadOnlyConfirmed] = useState(!!apiKey);
  const [lastApiKey, setLastApiKey] = useState(apiKey);

  // A confirmed key that leaves the draft was saved or discarded, so the input
  // lets go of it too.
  if (apiKey !== lastApiKey) {
    setLastApiKey(apiKey);
    if (apiKey === undefined && readOnlyConfirmed && value.trim() === lastApiKey) {
      setValue('');
      setReadOnlyConfirmed(false);
    }
  }

  const { project } = useProject(projectId);
  const projectIsPublic = project?.visibility === 'public';

  const { data: orgKeysData } = useQuery({
    ...getProjectOrganizationKeysOptions({ path: { project_id: projectId } }),
    // Without the shared keys the field still takes a typed value, so a
    // failure here narrows the choice rather than breaking the form.
    meta: { errorMessage: 'Failed to load organization keys', showUser: false },
  });
  const orgKeys = orgKeysData?.items ?? NO_KEYS;
  const orgKeyId = organizationApiKeyId ?? null;

  const emitTyped = (nextValue: string, nextConfirmed: boolean) => {
    const key = nextValue.trim();
    onChange({ organizationApiKeyId: null, apiKey: key && nextConfirmed ? key : undefined });
  };

  const pickSource = (raw: string) => {
    if (raw === MANUAL) {
      emitTyped(value, readOnlyConfirmed);
      return;
    }
    onChange({ organizationApiKeyId: Number(raw) });
  };

  const status = apiKey ? (
    <span className="text-[11px] text-emerald-600">Saved with the imagery</span>
  ) : value.trim() && !readOnlyConfirmed ? (
    <span className="text-[11px] text-amber-600">Confirm the key is read-only</span>
  ) : configured ? (
    <span className="text-[11px] text-emerald-600">Key configured ✓</span>
  ) : (
    <span className="text-[11px] text-amber-600">No key set</span>
  );

  return (
    <div className="mt-1 space-y-1.5">
      <p className="text-[11px] text-neutral-500 leading-snug">
        This provider needs an API key to serve its tiles. The key is encrypted on the server and
        used only to load tiles on each annotator&apos;s behalf - it is never sent to their browser,
        shown in tile links, or visible to them. You can update or replace it any time.
      </p>
      {orgKeys.length > 0 && (
        <Select
          size="sm"
          value={orgKeyId === null ? MANUAL : String(orgKeyId)}
          onChange={(e) => pickSource(e.target.value)}
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
      )}
      {orgKeyId !== null ? (
        <SharedKeyAudience projectIsPublic={projectIsPublic} />
      ) : (
        <>
          <ReadOnlyKeyConsent
            confirmed={readOnlyConfirmed}
            onChange={(confirmed) => {
              setReadOnlyConfirmed(confirmed);
              emitTyped(value, confirmed);
            }}
          />
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              type="password"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                emitTyped(e.target.value, readOnlyConfirmed);
              }}
              placeholder={configured ? 'Replace API key' : 'Paste provider API key'}
              autoComplete="off"
              aria-label="Provider API key"
              className="!w-56 text-[11px] font-mono"
            />
            {status}
          </div>
        </>
      )}
    </div>
  );
};
