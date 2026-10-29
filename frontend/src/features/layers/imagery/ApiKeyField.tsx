import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type OrganizationApiKeyOut } from '~/api/client';
import { getProjectOrganizationKeysOptions } from '~/api/queries';
import { useProject } from '~/app/projectRoute';
import { KeySourcePicker, type ProviderKeyChoice } from './KeySourcePicker';

export type { ProviderKeyChoice };

interface ApiKeyFieldProps {
  projectId: number;
  /** Whether the saved layer already has a key server-side. */
  configured?: boolean;
  organizationApiKeyId?: number | null;
  /** A typed key not saved yet. */
  apiKey?: string;
  onChange: (choice: ProviderKeyChoice) => void;
}

const NO_KEYS: OrganizationApiKeyOut[] = [];

/** A layer's provider key, saved with the imagery it belongs to. */
export const ApiKeyField = ({
  projectId,
  configured,
  organizationApiKeyId,
  apiKey,
  onChange,
}: ApiKeyFieldProps) => {
  const { t } = useTranslation('imagery');
  const { project } = useProject(projectId);
  const { data: orgKeysData } = useQuery({
    ...getProjectOrganizationKeysOptions({ path: { project_id: projectId } }),
    // Without the shared keys the field still takes a typed value, so a
    // failure here narrows the choice rather than breaking the form.
    meta: { errorMessage: t('keys.loadOrgKeysFailed'), showUser: false },
  });

  return (
    <KeySourcePicker
      label={t('keys.providerKey')}
      explainer={t('keys.providerKeyExplainer')}
      orgKeys={orgKeysData?.items ?? NO_KEYS}
      projectIsPublic={project?.visibility === 'public'}
      organizationApiKeyId={organizationApiKeyId ?? null}
      apiKey={apiKey}
      configured={configured}
      onChange={onChange}
    />
  );
};
