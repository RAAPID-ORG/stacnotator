import { useEffect, useState } from 'react';
import {
  getProjectOrganizationKeys,
  type OrganizationApiKeyOut,
  type PlanetCredentials,
} from '~/api/client';
import { Button, Input, Select } from '~/shared/ui/forms';
import { ReadOnlyKeyConsent } from '~/shared/ui/ReadOnlyKeyConsent';
import { handleError } from '~/shared/utils/errorHandler';

interface PlanetKeyConnectProps {
  projectId: number;
  /** Set once the caller may start spending the key, cleared whenever the choice
   *  changes so nothing browsed with the previous one survives. */
  credentials: PlanetCredentials | null;
  onChange: (credentials: PlanetCredentials | null) => void;
}

const OWN_KEY = 'own';

/**
 * Pick which Planet key to browse with. Shared by both Planet flows: a pasted key
 * is a secret either way, and connecting is an explicit step so a keystroke does
 * not fire a request at Planet.
 */
export const PlanetKeyConnect = ({ projectId, credentials, onChange }: PlanetKeyConnectProps) => {
  const [keys, setKeys] = useState<OrganizationApiKeyOut[] | null>(null);
  const [keyId, setKeyId] = useState<number | null>(null);
  const [ownKey, setOwnKey] = useState('');
  const [readOnlyConfirmed, setReadOnlyConfirmed] = useState(false);

  useEffect(() => {
    void getProjectOrganizationKeys({ path: { project_id: projectId } })
      .then(({ data }) => {
        const items = data?.items ?? [];
        setKeys(items);
        // A shared key is the better default when the organization has one.
        setKeyId(items[0]?.id ?? null);
      })
      .catch((err) => {
        setKeys([]);
        handleError(err, 'Failed to load organization keys', { showUser: false });
      });
  }, [projectId]);

  const canConnect = keyId !== null || (ownKey.trim().length > 0 && readOnlyConfirmed);

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-neutral-700 font-medium">Planet API key</label>
      <p className="text-[11px] text-neutral-500 leading-snug">
        Use one of your organization&apos;s shared keys, or provide a key for this campaign. The key
        is encrypted on the server and used only to fetch tiles on each annotator&apos;s behalf - it
        never reaches their browser.
      </p>
      <Select
        size="sm"
        value={keyId === null ? OWN_KEY : String(keyId)}
        onChange={(e) => {
          setKeyId(e.target.value === OWN_KEY ? null : Number(e.target.value));
          onChange(null);
        }}
        aria-label="Planet key source"
      >
        {(keys ?? []).map((key) => (
          <option key={key.id} value={key.id}>
            {key.name} (organization)
          </option>
        ))}
        <option value={OWN_KEY}>Enter a key for this campaign</option>
      </Select>

      {keyId === null && (
        <>
          <Input
            size="sm"
            type="password"
            value={ownKey}
            onChange={(e) => {
              setOwnKey(e.target.value);
              onChange(null);
            }}
            placeholder="Paste your Planet API key"
            autoComplete="off"
            className="text-[11px] font-mono"
          />
          <ReadOnlyKeyConsent confirmed={readOnlyConfirmed} onChange={setReadOnlyConfirmed} />
        </>
      )}

      {!credentials && (
        <Button
          variant="secondary"
          size="sm"
          disabled={!canConnect}
          onClick={() =>
            onChange(
              keyId !== null
                ? { project_id: projectId, organization_api_key_id: keyId }
                : { project_id: projectId, api_key: ownKey.trim() }
            )
          }
        >
          Connect to Planet
        </Button>
      )}
    </div>
  );
};
