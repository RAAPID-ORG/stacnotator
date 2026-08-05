import { Fragment, useState } from 'react';
import type { OrganizationOut } from '~/api/client';
import { Badge, type BadgeTone } from '~/shared/ui/Badge';
import { Button, Switch } from '~/shared/ui/forms';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { accessDraftChanges, type AccessDraft } from './orgAccessDraft';

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

const rowActionCls =
  'inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

const COL_SPAN = 4;

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
  const showAlert = useLayoutStore((s) => s.showAlert);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editor, setEditor] = useState<AccessDraft | null>(null);
  const [savingAccess, setSavingAccess] = useState(false);

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

  const toggleAccessEditor = async (organization: OrganizationOut) => {
    if (editor?.organizationId === organization.id) {
      setEditor(null);
      return;
    }
    setEditor(null);
    await run(organization.id, 'Failed to load organization access', async () => {
      const tilerNames = allTilers.length > 0 ? await onLoadTilers(organization.id) : [];
      setEditor({
        organizationId: organization.id,
        initialTilers: tilerNames,
        selectedTilers: tilerNames,
        internalStorage: organization.allows_internal_storage,
      });
    });
  };

  const toggleTiler = (tilerName: string) =>
    setEditor((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            selectedTilers: prev.selectedTilers.includes(tilerName)
              ? prev.selectedTilers.filter((name) => name !== tilerName)
              : [...prev.selectedTilers, tilerName],
          }
    );

  const saveAccess = async (organization: OrganizationOut) => {
    if (!editor) return;
    const { tilersChanged, storageChanged } = accessDraftChanges(
      editor,
      organization.allows_internal_storage
    );

    setSavingAccess(true);
    try {
      if (tilersChanged) await onSaveTilers(organization.id, editor.selectedTilers);
      if (storageChanged) await onSetInternalStorage(organization.id, editor.internalStorage);
      if (!tilersChanged && !storageChanged) showAlert('No access changes to apply', 'info');
      setEditor(null);
    } catch (err) {
      handleError(err, 'Failed to save organization access');
    } finally {
      setSavingAccess(false);
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
            <th className="px-4 py-3 text-right text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {loading ? (
            <tr>
              <td colSpan={COL_SPAN} className="px-4 py-10">
                <div className="flex flex-col items-center gap-2">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-brand-600" />
                  <span className="text-xs text-neutral-500">Loading organizations…</span>
                </div>
              </td>
            </tr>
          ) : organizations.length === 0 ? (
            <tr>
              <td colSpan={COL_SPAN} className="px-4 py-10 text-center text-sm text-neutral-500">
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
                      <span
                        data-org-internal-storage={
                          organization.allows_internal_storage ? 'yes' : 'no'
                        }
                      >
                        <Badge tone={organization.allows_internal_storage ? 'brand' : 'neutral'}>
                          {organization.allows_internal_storage ? 'Allowed' : 'Off'}
                        </Badge>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleAccessEditor(organization)}
                          disabled={busy}
                          className={`${rowActionCls} text-brand-700 hover:bg-brand-50`}
                        >
                          {editing ? 'Close' : 'Edit access'}
                        </button>
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
                      <td colSpan={COL_SPAN} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                          <Switch
                            checked={editor.internalStorage}
                            onChange={(internalStorage) =>
                              setEditor((prev) =>
                                prev === null ? prev : { ...prev, internalStorage }
                              )
                            }
                            disabled={savingAccess}
                            label="Internal storage"
                            aria-label="Internal storage"
                          />
                          {allTilers.length > 0 && (
                            <div className="flex flex-wrap items-center gap-4 pl-6 border-l border-neutral-200">
                              <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                                Tile access
                              </span>
                              {allTilers.map((name) => (
                                <label
                                  key={name}
                                  className="inline-flex items-center gap-2 text-xs text-neutral-700"
                                >
                                  <input
                                    type="checkbox"
                                    checked={editor.selectedTilers.includes(name)}
                                    onChange={() => toggleTiler(name)}
                                    disabled={savingAccess}
                                    className="w-4 h-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-600 disabled:cursor-not-allowed"
                                  />
                                  {name}
                                </label>
                              ))}
                            </div>
                          )}
                          <div className="ml-auto flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => saveAccess(organization)}
                              disabled={savingAccess}
                            >
                              {savingAccess ? 'Saving…' : 'Save access'}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditor(null)}
                              disabled={savingAccess}
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
