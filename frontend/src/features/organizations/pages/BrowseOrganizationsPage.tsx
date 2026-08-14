import { useCallback, useEffect, useState } from 'react';
import {
  listOrganizationDirectory,
  requestOrganizationAccess,
  type OrganizationDirectoryEntry,
} from '~/api/client';
import { organizationPath } from '~/app/routes';
import { Link } from 'react-router-dom';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Badge } from '~/shared/ui/Badge';
import { Delayed } from '~/shared/ui/Delayed';
import { Button, Field, Textarea } from '~/shared/ui/forms';
import { FadeIn } from '~/shared/ui/motion';
import { Skeleton } from '~/shared/ui/Skeleton';
import { handleError } from '~/shared/utils/errorHandler';
import { useOrganizationsStore } from '../stores/organizations.store';

/** The note is optional, but it is all an org admin has to go on, so the form
 *  asks for it rather than firing the request off a bare button. */
const RequestForm = ({
  org,
  onCancel,
  onSent,
}: {
  org: OrganizationDirectoryEntry;
  onCancel: () => void;
  onSent: () => Promise<void>;
}) => {
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      await requestOrganizationAccess({
        path: { organization_id: org.id },
        body: { note: note.trim() || null },
      });
      await onSent();
    } catch (err) {
      handleError(err, 'Failed to send access request');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 max-w-xl">
      <Field label="Why do you need access?" htmlFor={`org-request-note-${org.id}`}>
        <Textarea
          id={`org-request-note-${org.id}`}
          data-testid="access-request-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional - who you are and what you plan to work on."
          disabled={sending}
        />
      </Field>
      <div className="flex gap-2">
        <Button onClick={send} disabled={sending} data-testid="send-access-request">
          {sending ? 'Sending…' : 'Send request'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

const OrganizationRow = ({
  org,
  onRequested,
}: {
  org: OrganizationDirectoryEntry;
  onRequested: () => Promise<void>;
}) => {
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
            <Badge tone="green">Member</Badge>
          </Link>
        ) : org.membership === 'pending' ? (
          <Badge tone="yellow">Requested</Badge>
        ) : requesting ? null : (
          <Button size="sm" variant="secondary" onClick={() => setRequesting(true)}>
            Request access
          </Button>
        )}
      </div>
      {requesting && org.membership === 'none' && (
        <RequestForm
          org={org}
          onCancel={() => setRequesting(false)}
          onSent={async () => {
            setRequesting(false);
            await onRequested();
          }}
        />
      )}
    </li>
  );
};

export const BrowseOrganizationsPage = () => {
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);
  const refreshMine = useOrganizationsStore((s) => s.refresh);
  const [items, setItems] = useState<OrganizationDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: 'Organizations' }]);
  }, [setBreadcrumbs]);

  const load = useCallback(async () => {
    try {
      const { data } = await listOrganizationDirectory();
      setItems(data?.items ?? []);
      setError(null);
    } catch (err) {
      setError(handleError(err, 'Failed to load organizations', { showUser: false }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // An approved request turns into a membership, so the sidebar's own list of
  // "my organizations" has to be re-read too.
  const afterRequest = async () => {
    await load();
    await refreshMine();
  };

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page space-y-4">
        <header className="page-header">
          <div>
            <h1 className="page-title">Organizations</h1>
            <p className="page-subtitle">
              Every organization on the platform. Ask an admin for access to the one you work with.
            </p>
          </div>
        </header>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <Delayed>
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          </Delayed>
        ) : items.length === 0 ? (
          <p className="text-sm text-neutral-500">No organizations yet.</p>
        ) : (
          <ul
            className="divide-y divide-neutral-100 border border-neutral-200 rounded-xl bg-white"
            data-testid="organization-directory"
          >
            {items.map((org) => (
              <OrganizationRow key={org.id} org={org} onRequested={afterRequest} />
            ))}
          </ul>
        )}
      </FadeIn>
    </div>
  );
};
