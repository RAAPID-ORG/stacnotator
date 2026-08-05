import { Fragment, useState } from 'react';
import type { OrganizationOut } from '~/api/client';
import { Badge, type BadgeTone } from '~/shared/ui/Badge';
import { Button } from '~/shared/ui/forms';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';

export type PlatformOrganizationsTableProps = {
  organizations: OrganizationOut[];
  allTilers: string[];
  onApprove: (organizationId: number) => Promise<void>;
  onReject: (organizationId: number) => Promise<void>;
  onSetInternalStorage: (organizationId: number, allowed: boolean) => Promise<void>;
  onLoadTilers: (organizationId: number) => Promise<string[]>;
  onSaveTilers: (organizationId: number, tilerNames: string[]) => Promise<void>;
  loading: boolean;
};

const STATUS_TONES: Record<string, BadgeTone> = {
  pending: 'yellow',
  approved: 'brand',
  rejected: 'red',
};

const chipCls =
  'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const rowActionCls =
  'inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

type TilerEditor = {
  organizationId: number;
  selected: string[];
};

export const PlatformOrganizationsTable = ({
  organizations,
  allTilers,
  onApprove,
  onReject,
  onSetInternalStorage,
  onLoadTilers,
  onSaveTilers,
  loading,
}: PlatformOrganizationsTableProps) => {
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editor, setEditor] = useState<TilerEditor | null>(null);
  const [savingTilers, setSavingTilers] = useState(false);

  const showTilerColumn = allTilers.length > 0;
  const colSpan = showTilerColumn ? 5 : 4;

  const run = async (organizationId: number, message: string, action: () => Promise<void>) => {
    setBusyId(organizationId);
    try {
      await action();
    } catch (err) {
      handleError(err, message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDecision = async (organization: OrganizationOut, approve: boolean) => {
    const confirmed = await showConfirmDialog({
      title: approve ? `Approve ${organization.name}?` : `Reject ${organization.name}?`,
      description: approve
        ? 'Members will be able to create projects and campaigns under this organization.'
        : 'Members lose access to this organization until it is approved again.',
      confirmText: approve ? 'Approve' : 'Reject',
      isDangerous: !approve,
    });
    if (!confirmed) return;

    await run(
      organization.id,
      approve ? 'Failed to approve organization' : 'Failed to reject organization',
      () => (approve ? onApprove(organization.id) : onReject(organization.id))
    );
  };

  const handleInternalStorage = (organization: OrganizationOut) =>
    run(organization.id, 'Failed to update internal storage', () =>
      onSetInternalStorage(organization.id, !organization.allows_internal_storage)
    );

  const toggleTilerEditor = async (organizationId: number) => {
    if (editor?.organizationId === organizationId) {
      setEditor(null);
      return;
    }
    setEditor(null);
    await run(organizationId, 'Failed to load organization tile access', async () => {
      const tilerNames = await onLoadTilers(organizationId);
      setEditor({ organizationId, selected: tilerNames });
    });
  };

  const toggleTiler = (tilerName: string) =>
    setEditor((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            selected: prev.selected.includes(tilerName)
              ? prev.selected.filter((name) => name !== tilerName)
              : [...prev.selected, tilerName],
          }
    );

  const saveTilers = async () => {
    if (!editor) return;
    setSavingTilers(true);
    try {
      await onSaveTilers(editor.organizationId, editor.selected);
      setEditor(null);
    } catch (err) {
      handleError(err, 'Failed to save organization tile access');
    } finally {
      setSavingTilers(false);
    }
  };

  return (
    <div className="overflow-x-auto border border-neutral-200 rounded-xl shadow-sm bg-white">
      <table className="w-full">
        <thead className="bg-neutral-50/50 border-b border-neutral-200">
          <tr>
            <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
              Organization
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
              Status
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
              Internal storage
            </th>
            {showTilerColumn && (
              <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
                Tile access
              </th>
            )}
            <th className="px-4 py-3 text-right text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {loading ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10">
                <div className="flex flex-col items-center gap-2">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-brand-600" />
                  <span className="text-xs text-neutral-500">Loading organizations…</span>
                </div>
              </td>
            </tr>
          ) : organizations.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-neutral-500">
                No organizations found
              </td>
            </tr>
          ) : (
            organizations.map((organization) => {
              const busy = busyId === organization.id;
              const pending = organization.status === 'pending';
              const editing = editor?.organizationId === organization.id;

              return (
                <Fragment key={organization.id}>
                  <tr
                    data-org-status={organization.status}
                    className={`transition-colors ${
                      pending ? 'bg-yellow-50/60 hover:bg-yellow-50' : 'hover:bg-neutral-50/60'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm text-neutral-900">{organization.name}</div>
                      {organization.description && (
                        <div className="text-xs text-neutral-500">{organization.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONES[organization.status] ?? 'neutral'}>
                        <span className="capitalize">{organization.status}</span>
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        data-org-internal-storage={
                          organization.allows_internal_storage ? 'yes' : 'no'
                        }
                        onClick={() => handleInternalStorage(organization)}
                        disabled={busy}
                        title={
                          organization.allows_internal_storage
                            ? 'Disable managed-identity storage'
                            : 'Allow managed-identity storage'
                        }
                        className={`${chipCls} ${
                          organization.allows_internal_storage
                            ? 'bg-brand-50 text-brand-800 border-brand-200'
                            : 'bg-neutral-50 text-neutral-500 border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        <span aria-hidden className="w-2 text-center leading-none">
                          {organization.allows_internal_storage ? '✓' : '+'}
                        </span>
                        Allowed
                      </button>
                    </td>
                    {showTilerColumn && (
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleTilerEditor(organization.id)}
                          disabled={busy}
                          className={`${rowActionCls} text-brand-700 hover:bg-brand-50`}
                        >
                          {editing ? 'Close' : 'Edit tile access'}
                        </button>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {organization.status !== 'approved' && (
                          <button
                            type="button"
                            onClick={() => handleDecision(organization, true)}
                            disabled={busy}
                            className={`${rowActionCls} bg-white text-neutral-700 border border-neutral-300 hover:bg-neutral-50`}
                          >
                            Approve
                          </button>
                        )}
                        {organization.status !== 'rejected' && (
                          <button
                            type="button"
                            onClick={() => handleDecision(organization, false)}
                            disabled={busy}
                            className={`${rowActionCls} text-red-600 hover:bg-red-50`}
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {editing && (
                    <tr className="bg-neutral-50/60">
                      <td colSpan={colSpan} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-4">
                          {allTilers.map((name) => (
                            <label
                              key={name}
                              className="inline-flex items-center gap-2 text-xs text-neutral-700"
                            >
                              <input
                                type="checkbox"
                                checked={editor.selected.includes(name)}
                                onChange={() => toggleTiler(name)}
                                disabled={savingTilers}
                                className="w-4 h-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-600 disabled:cursor-not-allowed"
                              />
                              {name}
                            </label>
                          ))}
                          <div className="ml-auto flex gap-2">
                            <Button size="sm" onClick={saveTilers} disabled={savingTilers}>
                              {savingTilers ? 'Saving…' : 'Save tile access'}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditor(null)}
                              disabled={savingTilers}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
