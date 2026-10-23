import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const STATUSES = ['pending', 'approved', 'rejected'] as const;
const isKnownStatus = (status: string): status is (typeof STATUSES)[number] =>
  (STATUSES as readonly string[]).includes(status);

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
  const { t } = useTranslation(['settings', 'common']);
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
      title: approve
        ? t('orgsTable.confirm.approveTitle', { name: organization.name })
        : t('orgsTable.confirm.rejectTitle', { name: organization.name }),
      description: approve
        ? t('orgsTable.confirm.approveDescription')
        : t('orgsTable.confirm.rejectDescription'),
      confirmText: approve ? t('orgsTable.approve') : t('orgsTable.reject'),
      isDangerous: !approve,
    });
    if (!confirmed) return;

    await run(
      organization.id,
      approve ? t('toasts.approveOrgFailed') : t('toasts.rejectOrgFailed'),
      () => (approve ? onApprove(organization.id) : onReject(organization.id))
    );
  };

  const toggleAccessEditor = async (organization: OrganizationOut) => {
    if (editor?.organizationId === organization.id) {
      setEditor(null);
      return;
    }
    setEditor(null);
    await run(organization.id, t('toasts.loadAccessFailed'), async () => {
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
      if (!tilersChanged && !storageChanged) showAlert(t('toasts.noAccessChanges'), 'info');
      setEditor(null);
    } catch (err) {
      handleError(err, t('toasts.saveAccessFailed'));
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
              {t('orgsTable.organization')}
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
              {t('orgsTable.status')}
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
              {t('orgsTable.internalStorage')}
            </th>
            <th className="px-4 py-3 text-right text-[11px] font-medium text-neutral-600 uppercase tracking-wider">
              {t('orgsTable.actions')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {loading ? (
            <tr>
              <td colSpan={COL_SPAN} className="px-4 py-10">
                <div className="flex flex-col items-center gap-2">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-brand-600" />
                  <span className="text-xs text-neutral-500">{t('orgsTable.loading')}</span>
                </div>
              </td>
            </tr>
          ) : organizations.length === 0 ? (
            <tr>
              <td colSpan={COL_SPAN} className="px-4 py-10 text-center text-sm text-neutral-500">
                {t('orgsTable.empty')}
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
                        <span className="capitalize">
                          {isKnownStatus(organization.status)
                            ? t(`orgsTable.statuses.${organization.status}`)
                            : organization.status}
                        </span>
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        data-org-internal-storage={
                          organization.allows_internal_storage ? 'yes' : 'no'
                        }
                      >
                        <Badge tone={organization.allows_internal_storage ? 'brand' : 'neutral'}>
                          {organization.allows_internal_storage
                            ? t('orgsTable.allowed')
                            : t('orgsTable.off')}
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
                          {editing ? t('orgsTable.close') : t('orgsTable.editAccess')}
                        </button>
                        {organization.status !== 'approved' && (
                          <button
                            type="button"
                            onClick={() => handleDecision(organization, true)}
                            disabled={busy}
                            className={`${rowActionCls} bg-white text-neutral-700 border border-neutral-300 hover:bg-neutral-50`}
                          >
                            {t('orgsTable.approve')}
                          </button>
                        )}
                        {organization.status !== 'rejected' && (
                          <button
                            type="button"
                            onClick={() => handleDecision(organization, false)}
                            disabled={busy}
                            className={`${rowActionCls} text-red-600 hover:bg-red-50`}
                          >
                            {t('orgsTable.reject')}
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
                            label={t('orgsTable.internalStorage')}
                            aria-label={t('orgsTable.internalStorage')}
                          />
                          {allTilers.length > 0 && (
                            <div className="flex flex-wrap items-center gap-4 pl-6 border-l border-neutral-200">
                              <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                                {t('orgsTable.tileAccess')}
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
                              {savingAccess ? t('orgsTable.saving') : t('orgsTable.saveAccess')}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditor(null)}
                              disabled={savingAccess}
                            >
                              {t('common:actions.cancel')}
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
