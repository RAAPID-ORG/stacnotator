import { useEffect, useRef, useState } from 'react';
import {
  getProject,
  getProjectOrganizationKeys,
  type OrganizationApiKeyOut,
  type PlanetCredentials,
} from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import { KeySourcePicker, type ProviderKeyChoice } from './KeySourcePicker';

interface PlanetKeyConnectProps {
  projectId: number;
  /** The key to spend, or null while the choice is incomplete - a pasted key
   *  counts only once its owner has confirmed it is read-only. */
  onChange: (credentials: PlanetCredentials | null) => void;
}

/** Long enough that a pasted key is not sent character by character. */
const TYPING_SETTLES_MS = 250;

/** Pick which Planet key to browse with, shared by both Planet flows. */
export const PlanetKeyConnect = ({ projectId, onChange }: PlanetKeyConnectProps) => {
  const [keys, setKeys] = useState<OrganizationApiKeyOut[]>([]);
  const [choice, setChoice] = useState<ProviderKeyChoice>({ organizationApiKeyId: null });
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
        if (items[0]) setChoice({ organizationApiKeyId: items[0].id });
      })
      .catch((err) => handleError(err, 'Failed to load organization keys', { showUser: false }));
  }, [projectId]);

  useEffect(() => {
    // Context for the choice above, not the choice itself: if this read fails the
    // picker still works, one caveat poorer.
    void getProject({ path: { project_id: projectId } })
      .then(({ data }) => setProjectIsPublic(data?.visibility === 'public'))
      .catch((err) => handleError(err, 'Failed to load project', { showUser: false }));
  }, [projectId]);

  useEffect(() => {
    if (choice.organizationApiKeyId !== null) {
      emit.current({ project_id: projectId, organization_api_key_id: choice.organizationApiKeyId });
      return;
    }
    const key = choice.apiKey;
    if (!key) {
      emit.current(null);
      return;
    }
    const timer = setTimeout(
      () => emit.current({ project_id: projectId, api_key: key }),
      TYPING_SETTLES_MS
    );
    return () => clearTimeout(timer);
  }, [projectId, choice]);

  return (
    <KeySourcePicker
      label="Planet API key"
      explainer={
        <>
          Used to browse Planet and to load its tiles on each annotator&apos;s behalf. The key is
          encrypted on the server and never reaches their browser.
        </>
      }
      orgKeys={keys}
      projectIsPublic={projectIsPublic}
      organizationApiKeyId={choice.organizationApiKeyId}
      apiKey={choice.apiKey}
      placeholder="Paste your Planet API key"
      onChange={setChoice}
    />
  );
};
