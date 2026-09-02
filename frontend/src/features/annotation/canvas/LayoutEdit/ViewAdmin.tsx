import { useState } from 'react';
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
  IconTrash,
} from '~/shared/ui/Icons';
import { collectionsInView } from '../../campaign/imagery';
import { useCampaign, useCampaignStore } from '../../stores/campaign';
import { useLayoutStore as useCanvasLayoutStore } from '../../stores/layout';

const iconButton =
  'grid h-6 w-6 shrink-0 place-items-center rounded-md text-neutral-400 transition-colors ' +
  'hover:bg-neutral-200/70 hover:text-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent';

export function ViewAdmin() {
  const campaign = useCampaign();
  const setCampaign = useCampaignStore.getState().setCampaign;
  const selectedViewId = useCampaignStore((s) => s.view?.id ?? null);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const catalog = useCampaignStore((s) => s.catalog);
  const syncWindowsToView = useCanvasLayoutStore((s) => s.syncWindowsToView);
  const [editingViewId, setEditingViewId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ImageryViewOut | null>(null);
  const [busy, setBusy] = useState(false);

  const views = campaign.imagery_views;

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
      setCampaign({ ...campaign, imagery_views: [...views, res.data] });
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
      setCampaign({
        ...campaign,
        imagery_views: views.map((v) => (v.id === view.id ? updated : v)),
      });
    }, 'Failed to rename view');

  const handleDelete = (view: ImageryViewOut) =>
    withBusy(async () => {
      setPendingDelete(null);
      await deleteImageryView({ path: { campaign_id: campaign.id, view_id: view.id } });
      const remaining = views.filter((v) => v.id !== view.id);
      // Deleting the selected view is a real view switch - the imagery address
      // and the canvas windows still belong to the view that went - which the
      // campaign store carries out when it sees the selection disappear.
      setCampaign({ ...campaign, imagery_views: remaining });
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
      setCampaign({ ...campaign, imagery_views: reordered });
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
      setCampaign({
        ...campaign,
        imagery_views: views.map((v) => (v.id === view.id ? updated : v)),
      });
      // The server has already reconciled the stored layouts and handed back
      // the result; without this the new windows never reach the live canvas
      // and turn up in the hidden tray instead.
      if (catalog && updated.id === selectedViewId) {
        syncWindowsToView(updated, new Set(collectionsInView(catalog, updated).map((c) => c.id)));
      }
    }, 'Failed to update view sources');

  return (
    <div className="space-y-4" data-testid="view-admin">
      <div className="space-y-2" data-testid="view-manager">
        <span className="block text-[11px] font-medium uppercase tracking-wider text-neutral-500">
          Views
        </span>
        <ul className="space-y-0.5">
          {views.map((view, idx) => (
            <li
              key={view.id}
              className={`group rounded-lg transition-colors ${
                view.id === selectedViewId ? 'bg-brand-50' : 'hover:bg-neutral-50'
              }`}
            >
              <div className="flex items-center gap-1 px-1.5 py-1">
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
              </div>

              {/* Nested under the view it belongs to: which sources a view
                  carries is the thing this panel exists to make obvious, and
                  as a sibling section below the list it read as unrelated. */}
              {view.id === selectedViewId && (
                <div className="space-y-1 px-1.5 pb-2" data-testid="view-sources">
                  <span className="block pl-2 text-[10px] font-medium uppercase tracking-wider text-neutral-400">
                    Sources in this view
                  </span>
                  {campaign.imagery_sources.length === 0 ? (
                    <p className="pl-2 text-[11px] text-neutral-400">
                      No imagery sources yet - add one in campaign settings.
                    </p>
                  ) : (
                    <ul className="space-y-0.5 border-l border-brand-200 pl-2">
                      {campaign.imagery_sources.map((source) => (
                        <li key={source.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-white/70">
                            <input
                              type="checkbox"
                              checked={view.source_ids.includes(source.id)}
                              disabled={busy}
                              onChange={(e) => toggleSource(view, source.id, e.target.checked)}
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
                      ))}
                    </ul>
                  )}
                </div>
              )}
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
