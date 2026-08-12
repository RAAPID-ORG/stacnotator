import { useState } from 'react';
import {
  createImageryView,
  deleteImageryView,
  reorderImageryViews,
  updateImageryView,
  type CampaignOutFull,
  type ImageryViewOut,
} from '~/api/client';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { useLayoutStore } from '~/shared/stores/layout.store';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconPencil,
  IconTrash,
} from '~/shared/ui/Icons';
import { buildCatalog } from '~/features/annotation/core/catalog';
import { useSessionStore } from '~/features/annotation/stores';
import { fallbackCollectionFor } from '../../shared/viewSelection';

export interface ViewAdminProps {
  campaign: CampaignOutFull;
  onCampaignChange: (campaign: CampaignOutFull) => void;
}

const iconButton =
  'grid h-6 w-6 shrink-0 place-items-center rounded-md text-neutral-400 transition-colors ' +
  'hover:bg-neutral-200/70 hover:text-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent';

export function ViewAdmin({ campaign, onCampaignChange }: ViewAdminProps) {
  const selectedViewId = useSessionStore((s) => s.selectedViewId);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const selectView = useSessionStore((s) => s.selectView);
  const [editingViewId, setEditingViewId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ImageryViewOut | null>(null);
  const [busy, setBusy] = useState(false);

  const views = campaign.imagery_views;
  const selectedView = views.find((v) => v.id === selectedViewId) ?? null;

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
        body: { name: 'New view', source_ids: [] },
      });
      if (!res.data) throw new Error('create failed');
      onCampaignChange({ ...campaign, imagery_views: [...views, res.data] });
    }, 'Failed to create view');

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
      onCampaignChange({
        ...campaign,
        imagery_views: views.map((v) => (v.id === view.id ? updated : v)),
      });
    }, 'Failed to rename view');

  const handleDelete = (view: ImageryViewOut) =>
    withBusy(async () => {
      setPendingDelete(null);
      await deleteImageryView({ path: { campaign_id: campaign.id, view_id: view.id } });
      const remaining = views.filter((v) => v.id !== view.id);
      onCampaignChange({ ...campaign, imagery_views: remaining });

      // Deleting the selected view leaves the session pointing at a view that
      // is gone: the page falls back to rendering the first one while the
      // imagery address still belongs to the deleted view's collections, and
      // no row here looks selected. Selecting the replacement properly is what
      // moves the address with it.
      const replacement = view.id === selectedViewId ? remaining[0] : undefined;
      if (!replacement) return;
      const catalog = buildCatalog(campaign);
      selectView(
        replacement.id,
        catalog,
        fallbackCollectionFor(catalog, replacement.id, replacement.source_ids)
      );
    }, 'Failed to delete view');

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
      onCampaignChange({ ...campaign, imagery_views: reordered });
    }, 'Failed to reorder views');

  const toggleSource = (view: ImageryViewOut, sourceId: number, include: boolean) =>
    withBusy(async () => {
      const source_ids = include
        ? [...view.source_ids, sourceId]
        : view.source_ids.filter((id) => id !== sourceId);
      const res = await updateImageryView({
        path: { campaign_id: campaign.id, view_id: view.id },
        body: { source_ids },
      });
      if (!res.data) throw new Error('update failed');
      const updated = res.data;
      onCampaignChange({
        ...campaign,
        imagery_views: views.map((v) => (v.id === view.id ? updated : v)),
      });
    }, 'Failed to update view sources');

  return (
    <div className="space-y-4" data-testid="view-admin">
      <div className="space-y-2" data-testid="view-manager">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Views
        </span>
        <ul className="space-y-0.5">
          {views.map((view, idx) => (
            <li
              key={view.id}
              className={`group flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors ${
                view.id === selectedViewId ? 'bg-brand-50' : 'hover:bg-neutral-50'
              }`}
            >
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
                  aria-label="View name"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-left text-xs font-medium text-neutral-700">
                  {view.name || 'Untitled view'}
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
                aria-label={`Rename ${view.name}`}
                title="Rename"
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
                aria-label={`Move ${view.name} up`}
                title="Move up"
              >
                <IconChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={busy || idx === views.length - 1}
                onClick={() => moveView(view, 1)}
                className={iconButton}
                aria-label={`Move ${view.name} down`}
                title="Move down"
              >
                <IconChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPendingDelete(view)}
                className={`${iconButton} hover:text-red-600`}
                aria-label={`Delete ${view.name}`}
                title="Delete view"
              >
                <IconTrash className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={busy}
          onClick={handleCreate}
          className="w-full rounded-lg border border-dashed border-neutral-300 px-2 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
          data-testid="add-view"
        >
          + Add view
        </button>
      </div>

      {selectedView && (
        <div className="space-y-2" data-testid="view-sources">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Sources in this view
          </span>
          <ul className="space-y-0.5">
            {campaign.imagery_sources.map((source) => {
              const included = selectedView.source_ids.includes(source.id);
              return (
                <li key={source.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-neutral-50">
                    <input
                      type="checkbox"
                      checked={included}
                      disabled={busy}
                      onChange={(e) => toggleSource(selectedView, source.id, e.target.checked)}
                      className="h-3.5 w-3.5 cursor-pointer accent-brand-600"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-700">
                      {source.name}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">
                      {source.collections.length}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete view?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" and its saved layouts will be removed for all users.`
            : undefined
        }
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous
        onConfirm={() => {
          if (pendingDelete) void handleDelete(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
