import { useEffect, useRef, useState } from 'react';
import {
  getProject,
  getProjectOrganizationKeys,
  type OrganizationApiKeyOut,
  type PlanetCredentials,
} from '~/api/client';
import { Input, Select } from '~/shared/ui/forms';
import { ReadOnlyKeyConsent } from '~/shared/ui/ReadOnlyKeyConsent';
import { SharedKeyAudience } from './SharedKeyAudience';
import { handleError } from '~/shared/utils/errorHandler';

interface PlanetKeyConnectProps {
  projectId: number;
  /** The key to spend, or null while the choice is incomplete - a pasted key
   *  counts only once its owner has confirmed it is read-only. */
  onChange: (credentials: PlanetCredentials | null) => void;
}

const OWN_KEY = 'own';

/** Long enough that a pasted key is not sent character by character. */
const TYPING_SETTLES_MS = 250;

/** Pick which Planet key to browse with, shared by both Planet flows. */
export const PlanetKeyConnect = ({ projectId, onChange }: PlanetKeyConnectProps) => {
  const [keys, setKeys] = useState<OrganizationApiKeyOut[] | null>(null);
  const [keyId, setKeyId] = useState<number | null>(null);
  const [ownKey, setOwnKey] = useState('');
  const [readOnlyConfirmed, setReadOnlyConfirmed] = useState(false);
  const [projectIsPublic, setProjectIsPublic] = useState(false);

  // Callers pass an inline handler; keeping it out of the effect below is what
  // stops every render from re-emitting the same choice.
  const emit = useRef(onChange);
  emit.current = onChange;

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

  useEffect(() => {
    // Context for the choice above, not the choice itself: if this read fails the
    // picker still works, one caveat poorer.
    void getProject({ path: { project_id: projectId } })
      .then(({ data }) => setProjectIsPublic(data?.visibility === 'public'))
      .catch((err) => handleError(err, 'Failed to load project', { showUser: false }));
  }, [projectId]);

  useEffect(() => {
    if (keyId !== null) {
      emit.current({ project_id: projectId, organization_api_key_id: keyId });
      return;
    }
    const key = ownKey.trim();
    if (!key || !readOnlyConfirmed) {
      emit.current(null);
      return;
    }
    const timer = setTimeout(
      () => emit.current({ project_id: projectId, api_key: key }),
      TYPING_SETTLES_MS
    );
    return () => clearTimeout(timer);
  }, [projectId, keyId, ownKey, readOnlyConfirmed]);

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
        onChange={(e) => setKeyId(e.target.value === OWN_KEY ? null : Number(e.target.value))}
        aria-label="Planet key source"
      >
        {(keys ?? []).map((key) => (
          <option key={key.id} value={key.id}>
            {key.name} (organization)
          </option>
        ))}
        <option value={OWN_KEY}>Enter a key for this campaign</option>
      </Select>

      {keyId !== null && <SharedKeyAudience projectIsPublic={projectIsPublic} />}

      {keyId === null && (
        <>
          <Input
            size="sm"
            type="password"
            value={ownKey}
            onChange={(e) => setOwnKey(e.target.value)}
            placeholder="Paste your Planet API key"
            autoComplete="off"
            className="text-[11px] font-mono"
          />
          <ReadOnlyKeyConsent confirmed={readOnlyConfirmed} onChange={setReadOnlyConfirmed} />
        </>
      )}
    </div>
  );
};
