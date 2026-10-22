import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type OrganizationDirectoryEntry } from '~/api/client';
import {
  listOrganizationDirectoryOptions,
  listOrganizationDirectoryQueryKey,
  requestOrganizationAccessMutation,
} from '~/api/queries';
import { organizationPath } from '~/app/routes';
import { Link } from 'react-router-dom';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Badge } from '~/shared/ui/Badge';
import { Delayed } from '~/shared/ui/Delayed';
import { Button, Field, Textarea } from '~/shared/ui/forms';
import { FadeIn } from '~/shared/ui/motion';
import { Skeleton } from '~/shared/ui/Skeleton';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { useRefreshOrganizations } from '../hooks/useOrganizations';

const NO_ORGS: OrganizationDirectoryEntry[] = [];

/** The note is optional, but it is all an org admin has to go on, so the form
 *  asks for it rather than firing the request off a bare button. */
const RequestForm = ({
  org,
  onCancel,
  onSent,
}: {
  org: OrganizationDirectoryEntry;
  onCancel: () => void;
  onSent: () => void;
}) => {
  const { t } = useTranslation(['organizations', 'common']);
  const queryClient = useQueryClient();
  const refreshMine = useRefreshOrganizations();
  const [note, setNote] = useState('');

  const request = useMutation({
    ...requestOrganizationAccessMutation(),
    meta: { errorMessage: t('browse.requestFailed') },
    // The row's own badge comes from the directory; an approved request turns
    // into a membership, so the sidebar's list of "my organizations" moves too.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listOrganizationDirectoryQueryKey() });
      void refreshMine();
      onSent();
    },
  });
  const sending = request.isPending;

  const send = () =>
    request.mutate({
      path: { organization_id: org.id },
      body: { note: note.trim() || null },
    });

  return (
    <div className="mt-3 space-y-3 max-w-xl">
      <Field label={t('browse.noteLabel')} htmlFor={`org-request-note-${org.id}`}>
        <Textarea
          id={`org-request-note-${org.id}`}
          data-testid="access-request-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('browse.notePlaceholder')}
          disabled={sending}
        />
      </Field>
      <div className="flex gap-2">
        <Button onClick={send} disabled={sending} data-testid="send-access-request">
          {sending ? t('browse.sending') : t('browse.sendRequest')}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={sending}>
          {t('common:actions.cancel')}
        </Button>
      </div>
    </div>
  );
};

const OrganizationRow = ({ org }: { org: OrganizationDirectoryEntry }) => {
  const { t } = useTranslation('organizations');
  const [requesting, setRequesting] = useState(false);

  return (
    <li className="px-4 py-3" data-testid="directory-row" data-membership={org.membership}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-neutral-900 truncate">{org.name}</p>
          {org.description && <p className="text-xs text-neutral-500 mt-0.5">{org.description}</p>}
        </div>
        {org.membership === 'active' ? (
          <Link
            to={organizationPath(org.id)}
            className="text-[11px] font-medium text-brand-700 hover:underline shrink-0"
          >
            <Badge tone="green">{t('browse.member')}</Badge>
          </Link>
        ) : org.membership === 'pending' ? (
          <Badge tone="yellow">{t('browse.requested')}</Badge>
        ) : requesting ? null : (
          <Button size="sm" variant="secondary" onClick={() => setRequesting(true)}>
            {t('browse.requestAccess')}
          </Button>
        )}
      </div>
      {requesting && org.membership === 'none' && (
        <RequestForm
          org={org}
          onCancel={() => setRequesting(false)}
          onSent={() => setRequesting(false)}
        />
      )}
    </li>
  );
};

export const BrowseOrganizationsPage = () => {
  const { t } = useTranslation('organizations');
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);

  const {
    data,
    isPending: loading,
    error,
  } = useQuery({
    ...listOrganizationDirectoryOptions(),
    meta: { errorMessage: t('loadFailed'), showUser: false },
  });
  const items = data?.items ?? NO_ORGS;

  useEffect(() => {
    setBreadcrumbs([{ label: t('browse.breadcrumb') }]);
  }, [setBreadcrumbs, t]);

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page space-y-4">
        <header className="page-header">
          <div>
            <h1 className="page-title">{t('browse.title')}</h1>
            <p className="page-subtitle">{t('browse.subtitle')}</p>
          </div>
        </header>

        {error && (
          <p className="text-sm text-red-600">{extractErrorMessage(error, t('loadFailed'))}</p>
        )}

        {loading ? (
          <Delayed>
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          </Delayed>
        ) : items.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('browse.empty')}</p>
        ) : (
          <ul
            className="divide-y divide-neutral-100 border border-neutral-200 rounded-xl bg-white"
            data-testid="organization-directory"
          >
            {items.map((org) => (
              <OrganizationRow key={org.id} org={org} />
            ))}
          </ul>
        )}
      </FadeIn>
    </div>
  );
};
