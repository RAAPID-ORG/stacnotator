import { useState, type ReactNode } from 'react';
import type { OrganizationApiKeyOut } from '~/api/client';
import { IconBuilding, IconLock } from '~/shared/ui/Icons';
import { InfoPopover } from '~/shared/ui/InfoPopover';
import { ReadOnlyKeyConsent } from '~/shared/ui/ReadOnlyKeyConsent';
import { SecretInput, SecretStatus } from '~/shared/ui/SecretInput';
import { SegmentedControl } from '~/shared/ui/SegmentedControl';
import { Select } from '~/shared/ui/forms';
import { SharedKeyAudience } from './SharedKeyAudience';

export interface ProviderKeyChoice {
  organizationApiKeyId: number | null;
  /** A typed key, set only once its owner confirmed it is read-only. */
  apiKey?: string;
}

type KeySource = 'organization' | 'own';

interface KeySourcePickerProps {
  label: string;
  /** What the key is for and what happens to it, behind the label's info icon. */
  explainer: ReactNode;
  orgKeys: OrganizationApiKeyOut[];
  projectIsPublic?: boolean;
  organizationApiKeyId: number | null;
  /** A typed key not saved yet. */
  apiKey?: string;
  /** Whether a saved key of its own exists server-side. */
  configured?: boolean;
  placeholder?: string;
  onChange: (choice: ProviderKeyChoice) => void;
}

/**
 * Where a layer's provider key comes from, as one field: the organization's shared key
 * or one of its own. The choice between the two only appears when the organization has
 * shared keys; a key of its own is a single masked input with its state inside, and the
 * read-only confirmation follows it once there is a key to confirm.
 */
export const KeySourcePicker = ({
  label,
  explainer,
  orgKeys,
  projectIsPublic,
  organizationApiKeyId,
  apiKey,
  configured,
  placeholder = 'Paste API key',
  onChange,
}: KeySourcePickerProps) => {
  const [value, setValue] = useState(apiKey ?? '');
  const [confirmed, setConfirmed] = useState(!!apiKey);
  const [lastApiKey, setLastApiKey] = useState(apiKey);

  // A confirmed key that leaves the draft was saved or discarded, so the input
  // lets go of it too.
  if (apiKey !== lastApiKey) {
    setLastApiKey(apiKey);
    if (apiKey === undefined && confirmed && value.trim() === lastApiKey) {
      setValue('');
      setConfirmed(false);
    }
  }

  const source: KeySource = organizationApiKeyId !== null ? 'organization' : 'own';

  const emitOwn = (nextValue: string, nextConfirmed: boolean) => {
    const key = nextValue.trim();
    onChange({ organizationApiKeyId: null, apiKey: key && nextConfirmed ? key : undefined });
  };

  const pickSource = (next: KeySource) => {
    if (next === 'own') emitOwn(value, confirmed);
    else if (orgKeys[0]) onChange({ organizationApiKeyId: orgKeys[0].id });
  };

  const status = apiKey ? (
    <SecretStatus tone="ok">Ready to save</SecretStatus>
  ) : value.trim() && !confirmed ? (
    <SecretStatus tone="warn">Confirm below</SecretStatus>
  ) : configured ? (
    <SecretStatus tone="ok">Saved ✓</SecretStatus>
  ) : (
    <SecretStatus tone="muted">No key</SecretStatus>
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-neutral-700">{label}</span>
        <InfoPopover>{explainer}</InfoPopover>
      </div>

      {orgKeys.length > 0 && (
        <SegmentedControl
          aria-label={`${label} source`}
          value={source}
          onChange={pickSource}
          segments={[
            { value: 'organization', label: 'Organization key', Icon: IconBuilding },
            { value: 'own', label: 'Own key', Icon: IconLock },
          ]}
        />
      )}

      {source === 'organization' ? (
        <>
          {orgKeys.length > 1 ? (
            <Select
              size="sm"
              value={String(organizationApiKeyId)}
              onChange={(e) => onChange({ organizationApiKeyId: Number(e.target.value) })}
              aria-label="Organization key"
              data-testid="org-key-select"
            >
              {orgKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.name}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-[11px] text-neutral-600">
              Uses <strong className="font-medium">{orgKeys[0]?.name}</strong>, managed by your
              organization.
            </p>
          )}
          <SharedKeyAudience projectIsPublic={projectIsPublic} />
        </>
      ) : (
        <>
          <SecretInput
            aria-label={label}
            value={value}
            onChange={(next) => {
              setValue(next);
              emitOwn(next, confirmed);
            }}
            placeholder={configured ? 'Paste a new key to replace it' : placeholder}
            status={status}
          />
          {value.trim() && (
            <ReadOnlyKeyConsent
              confirmed={confirmed}
              onChange={(next) => {
                setConfirmed(next);
                emitOwn(value, next);
              }}
            />
          )}
        </>
      )}
    </div>
  );
};
