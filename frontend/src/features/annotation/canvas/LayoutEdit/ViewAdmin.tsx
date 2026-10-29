import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createImageryView,
  deleteImageryView,
  reorderImageryViews,
  updateImageryView,
  type ImageryViewOut,
} from '~/api/client';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { useLayoutStore } from '~/shared/stores/layout.store';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconPencil,
  IconPlus,
  IconTrash,
} from '~/shared/ui/Icons';
import { useCampaign, useCampaignStore } from '../../stores/campaign';

const iconButton =
  'grid h-5 w-5 shrink-0 place-items-center rounded text-neutral-400 transition-colors ' +
  'hover:bg-neutral-200/70 hover:text-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent';

export function ViewAdmin() {
  const { t } = useTranslation(['annotation', 'common']);
  const campaign = useCampaign();
  const setCampaign = useCampaignStore.getState().setCampaign;
  const selectedViewId = useCampaignStore((s) => s.view?.id ?? null);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const catalog = useCampaignStore((s) => s.catalog);
  const [editingViewId, setEditingViewId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ImageryViewOut | null>(null);
  const [busy, setBusy] = useState(false);

  const views = campaign.imagery_views;
  const sourceIds = views.find((view) => view.id === selectedViewId)?.source_ids ?? [];
  const sources = [
    ...sourceIds.flatMap((id) => campaign.imagery_sources.filter((source) => source.id === id)),
    ...campaign.imagery_sources.filter((source) => !sourceIds.includes(source.id)),
  ];

  const withBusy = async (fn: () => Promise<void>, failureMessage: string) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      showAlert(failureMessage, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () =>
    withBusy(async () => {
      const res = await createImageryView({
        path: { campaign_id: campaign.id },
        body: { name: t('views.newName'), source_ids: [] },
      });
      if (!res.data) throw new Error('create failed');
      setCampaign({ ...campaign, imagery_views: [...views, res.data] });
    }, t('views.createFailed'));

  const commitRename = (view: ImageryViewOut) =>
    withBusy(async () => {
      setEditingViewId(null);
      const name = draftName.trim();
      if (!name || name === view.name) return;
      const res = await updateImageryView({
        path: { campaign_id: campaign.id, view_id: view.id },
        body: { name },
      });
      if (!res.data) throw new Error('rename failed');
      const updated = res.data;
      setCampaign({
        ...campaign,
        imagery_views: views.map((v) => (v.id === view.id ? updated : v)),
      });
    }, t('views.renameFailed'));

  const handleDelete = (view: ImageryViewOut) =>
    withBusy(async () => {
      setPendingDelete(null);
      await deleteImageryView({ path: { campaign_id: campaign.id, view_id: view.id } });
      const remaining = views.filter((v) => v.id !== view.id);
      // Deleting the selected view is a real view switch - the imagery address
      // and the canvas windows still belong to the view that went - which the
      // campaign store carries out when it sees the selection disappear.
      setCampaign({ ...campaign, imagery_views: remaining });
    }, t('views.deleteFailed'));

  const moveView = (view: ImageryViewOut, direction: -1 | 1) =>
    withBusy(async () => {
      const idx = views.findIndex((v) => v.id === view.id);
      const swapWith = idx + direction;
      if (idx === -1 || swapWith < 0 || swapWith >= views.length) return;
      const reordered = [...views];
      [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
      await reorderImageryViews({
        path: { campaign_id: campaign.id },
        body: { view_ids: reordered.map((v) => v.id) },
      });
      setCampaign({ ...campaign, imagery_views: reordered });
    }, t('views.reorderFailed'));

  const saveSources = (view: ImageryViewOut, source_ids: number[]) =>
    withBusy(async () => {
      const res = await updateImageryView({
        path: { campaign_id: campaign.id, view_id: view.id },
        body: { source_ids },
      });
      if (!res.data) throw new Error('update failed');
      const updated = res.data;
      setCampaign({
        ...campaign,
        imagery_views: views.map((v) => (v.id === view.id ? updated : v)),
      });
    }, t('views.sourcesFailed'));

  const toggleSource = (view: ImageryViewOut, sourceId: number, include: boolean) => {
    const sourceIds = include
      ? [...view.source_ids, sourceId]
      : view.source_ids.filter((id) => id !== sourceId);
    if (sourceIds.length === 0) {
      showAlert(t('views.lastSource'), 'error');
      return;
    }
    return saveSources(view, sourceIds);
  };

  const moveSource = (view: ImageryViewOut, sourceId: number, direction: -1 | 1) => {
    const index = view.source_ids.indexOf(sourceId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= view.source_ids.length) return;
    const source_ids = [...view.source_ids];
    [source_ids[index], source_ids[target]] = [source_ids[target], source_ids[index]];
    return saveSources(view, source_ids);
  };

  return (
    <div data-testid="view-admin">
      <div className="space-y-1" data-testid="view-manager">
        <div className="flex items-center justify-between">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-neutral-500">
            {t('views.title')}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={handleCreate}
            aria-label={t('views.add')}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
            data-testid="add-view"
          >
            <IconPlus className="h-3 w-3" />
            {t('common:actions.add')}
          </button>
        </div>
        <ul className="space-y-0.5">
          {views.map((view, idx) => (
            <li
              key={view.id}
              className={`group rounded-md transition-colors ${
                view.id === selectedViewId ? 'bg-brand-50' : 'hover:bg-neutral-50'
              }`}
            >
              <div className="flex items-center gap-0.5 px-1 py-0.5">
                {editingViewId === view.id ? (
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(view)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(view);
                      if (e.key === 'Escape') setEditingViewId(null);
                    }}
                    className="min-w-0 flex-1 rounded border border-brand-300 px-1.5 py-0.5 text-xs focus:outline-none"
                    aria-label={t('views.name')}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-left text-xs font-medium text-neutral-700">
                    {view.name || t('views.untitled')}
                  </span>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (editingViewId === view.id) commitRename(view);
                    else {
                      setEditingViewId(view.id);
                      setDraftName(view.name);
                    }
                  }}
                  className={iconButton}
                  aria-label={t('views.renameLabel', { name: view.name })}
                  title={t('views.rename')}
                >
                  {editingViewId === view.id ? (
                    <IconCheck className="h-3.5 w-3.5" />
                  ) : (
                    <IconPencil className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  disabled={busy || idx === 0}
                  onClick={() => moveView(view, -1)}
                  className={iconButton}
                  aria-label={t('views.moveUpLabel', { name: view.name })}
                  title={t('views.moveUp')}
                >
                  <IconChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busy || idx === views.length - 1}
                  onClick={() => moveView(view, 1)}
                  className={iconButton}
                  aria-label={t('views.moveDownLabel', { name: view.name })}
                  title={t('views.moveDown')}
                >
                  <IconChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingDelete(view)}
                  className={`${iconButton} hover:text-red-600`}
                  aria-label={t('views.deleteLabel', { name: view.name })}
                  title={t('views.delete')}
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Nested under the view it belongs to: which sources a view
                  carries is the thing this panel exists to make obvious, and
                  as a sibling section below the list it read as unrelated. */}
              {view.id === selectedViewId && (
                <div className="space-y-0.5 px-1 pb-1" data-testid="view-sources">
                  <span className="block pl-2 text-[10px] font-medium uppercase tracking-wider text-neutral-400">
                    {t('views.sources')}
                  </span>
                  <p className="pl-2 text-[10px] text-neutral-400">{t('views.sourcesHint')}</p>
                  {campaign.imagery_sources.length === 0 ? (
                    <p className="pl-2 text-[11px] text-neutral-400">{t('views.noSources')}</p>
                  ) : (
                    <ul className="space-y-0.5 border-l border-brand-200 pl-2">
                      {sources.map((source) => {
                        const index = view.source_ids.indexOf(source.id);
                        return (
                          <li
                            key={source.id}
                            className="flex items-center gap-0.5"
                            data-source-id={source.id}
                          >
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-white/70">
                              <input
                                type="checkbox"
                                checked={index >= 0}
                                disabled={busy}
                                onChange={(e) => toggleSource(view, source.id, e.target.checked)}
                                className="h-3.5 w-3.5 cursor-pointer accent-brand-600"
                              />
                              <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-700">
                                {source.name}
                              </span>
                              {index === 0 && (
                                <span
                                  className="shrink-0 text-[9px] font-medium text-brand-600"
                                  title={t('views.firstTip')}
                                >
                                  {t('views.first')}
                                </span>
                              )}
                              <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">
                                {source.collections.length}
                              </span>
                            </label>
                            {index >= 0 && view.source_ids.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  disabled={busy || index === 0}
                                  onClick={() => moveSource(view, source.id, -1)}
                                  className={iconButton}
                                  aria-label={t('views.sourceUpLabel', { name: source.name })}
                                  title={t('views.sourceUp')}
                                >
                                  <IconChevronUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || index === view.source_ids.length - 1}
                                  onClick={() => moveSource(view, source.id, 1)}
                                  className={iconButton}
                                  aria-label={t('views.sourceDownLabel', { name: source.name })}
                                  title={t('views.sourceDown')}
                                >
                                  <IconChevronDown className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={t('views.deleteConfirm.title')}
        description={
          pendingDelete
            ? t('views.deleteConfirm.description', { name: pendingDelete.name })
            : undefined
        }
        confirmText={t('common:actions.delete')}
        cancelText={t('common:actions.cancel')}
        isDangerous
        onConfirm={() => {
          if (pendingDelete) void handleDelete(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
