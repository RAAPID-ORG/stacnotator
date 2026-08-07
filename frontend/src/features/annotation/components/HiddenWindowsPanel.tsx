import { useMemo, useRef, useState } from 'react';
import type { CampaignOutFull, ImageryViewOut } from '~/api/client';
import { useCampaignStore } from '../stores/campaign.store';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Button } from '~/shared/ui/forms';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconDragHandle,
  IconEye,
  IconEyeSlash,
  IconInfo,
  IconPencil,
  IconPlus,
  IconTrash,
  IconWindow,
} from '~/shared/ui/Icons';
import { GRID_COLS, isMainLayoutKey } from '../utils/layoutDefaults';
import { viewCollections } from '../utils/viewCollections';
import { useWindowDragStore } from '../stores/windowDrag.store';

// Panel resize bounds (px). The panel is anchored bottom-right and grows
// up/left from the top-left handle. Height is content-driven and capped by
// `panelSize.height` (a max), so the panel grows as windows are added.
const MIN_PANEL_W = 240;
const MIN_PANEL_H = 200;
const MAX_PANEL_W = 560;
const MAX_PANEL_H = 720;
const PANEL_SIZE_KEY = 'hiddenWindowsPanelSize';

// Newly-added window size is chosen via two sliders. Width is expressed as
// "windows per row" (more per row = narrower); height is in grid rows.
const MIN_PER_ROW = 2;
const MAX_PER_ROW = 10;
const MIN_WINDOW_H = 5;
const MAX_WINDOW_H = 20;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const sectionLabel = 'block text-[10px] font-semibold uppercase tracking-wider text-neutral-400';
const iconButton =
  'grid h-6 w-6 shrink-0 place-items-center rounded-md text-neutral-400 transition-colors ' +
  'hover:bg-neutral-200/70 hover:text-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent';

/** Admin-only: create, select, rename, reorder and delete the campaign's
 *  views. Structural changes persist immediately (the backend re-syncs the
 *  affected canvas layouts); only window geometry stays draft-until-save. */
const ViewManagerSection = ({
  campaign,
  selectedViewId,
}: {
  campaign: CampaignOutFull;
  selectedViewId: number | null;
}) => {
  const setSelectedViewId = useCampaignStore((s) => s.setSelectedViewId);
  const createView = useCampaignStore((s) => s.createView);
  const renameView = useCampaignStore((s) => s.renameView);
  const deleteView = useCampaignStore((s) => s.deleteView);
  const moveView = useCampaignStore((s) => s.moveView);

  const [editingViewId, setEditingViewId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');

  const commitRename = async (view: ImageryViewOut) => {
    setEditingViewId(null);
    const name = draftName.trim();
    if (name && name !== view.name) await renameView(view.id, name);
  };

  const confirmDelete = async (view: ImageryViewOut) => {
    const confirmed = await useLayoutStore.getState().showConfirmDialog({
      title: 'Delete view?',
      description: `"${view.name}" and its saved layouts will be removed for all users.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDangerous: true,
    });
    if (confirmed) await deleteView(view.id);
  };

  const views = campaign.imagery_views;

  return (
    <div className="space-y-2" data-testid="view-manager">
      <span className={sectionLabel}>Views</span>
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
              <button
                type="button"
                onClick={() => setSelectedViewId(view.id)}
                className={`min-w-0 flex-1 truncate text-left text-xs ${
                  view.id === selectedViewId
                    ? 'font-semibold text-brand-700'
                    : 'font-medium text-neutral-700'
                }`}
                title={`Switch to ${view.name}`}
              >
                {view.name || 'Untitled view'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (editingViewId === view.id) {
                  commitRename(view);
                } else {
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
              onClick={() => moveView(view.id, -1)}
              disabled={idx === 0}
              className={iconButton}
              aria-label={`Move ${view.name} up`}
              title="Move up"
            >
              <IconChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => moveView(view.id, 1)}
              disabled={idx === views.length - 1}
              className={iconButton}
              aria-label={`Move ${view.name} down`}
              title="Move down"
            >
              <IconChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => confirmDelete(view)}
              className={`${iconButton} hover:text-red-600`}
              aria-label={`Delete ${view.name}`}
              title="Delete view"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        size="sm"
        onClick={createView}
        leading={<IconPlus className="h-3.5 w-3.5" />}
        className="w-full"
        data-testid="add-view"
      >
        Add view
      </Button>
    </div>
  );
};

/** Admin-only: which sources belong to the selected view. Membership drives
 *  both the timeline imagery and which collections can be windows. */
const ViewSourcesSection = ({
  campaign,
  view,
}: {
  campaign: CampaignOutFull;
  view: ImageryViewOut;
}) => {
  const setViewSources = useCampaignStore((s) => s.setViewSources);

  const toggle = (sourceId: number, include: boolean) => {
    const next = include
      ? [...view.source_ids, sourceId]
      : view.source_ids.filter((id) => id !== sourceId);
    setViewSources(view.id, next);
  };

  return (
    <div className="space-y-2" data-testid="view-sources">
      <span className={sectionLabel}>Sources in this view</span>
      <ul className="space-y-0.5">
        {campaign.imagery_sources.map((source) => {
          const included = view.source_ids.includes(source.id);
          return (
            <li key={source.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-neutral-50">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={(e) => toggle(source.id, e.target.checked)}
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
  );
};

const perRowToWidth = (perRow: number) => Math.floor(GRID_COLS / perRow);
const widthToPerRow = (w: number) => clamp(Math.round(GRID_COLS / w), MIN_PER_ROW, MAX_PER_ROW);

function loadPanelSize(): { width: number; height: number } {
  try {
    const raw = localStorage.getItem(PANEL_SIZE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        width: clamp(parsed.width, MIN_PANEL_W, MAX_PANEL_W),
        height: clamp(parsed.height, MIN_PANEL_H, MAX_PANEL_H),
      };
    }
  } catch {
    // ignore malformed/absent value
  }
  return { width: 288, height: 520 };
}

/** Edit-mode-only layout panel. For every user it lists the view's
 *  collections currently absent from the layout (hidden windows) and the
 *  new-window size controls; campaign admins additionally manage the views
 *  themselves (create/rename/reorder/delete) and each view's source
 *  membership right here, where the result is immediately visible. */
export const HiddenWindowsPanel = () => {
  const campaign = useCampaignStore((s) => s.campaign);
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);
  const isEditingLayout = useCampaignStore((s) => s.isEditingLayout);
  const isCampaignAdmin = useCampaignStore((s) => s.isCampaignAdmin);
  const currentLayout = useCampaignStore((s) => s.currentLayout);
  const addWindow = useCampaignStore((s) => s.addWindow);
  const startWindowDrag = useWindowDragStore((s) => s.start);
  const hideAllWindows = useCampaignStore((s) => s.hideAllWindows);
  const newWindowSize = useCampaignStore((s) => s.newWindowSize);
  const setNewWindowSize = useCampaignStore((s) => s.setNewWindowSize);

  const [expanded, setExpanded] = useState(true);
  const [panelSize, setPanelSize] = useState(loadPanelSize);
  const resizeStart = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const view = campaign?.imagery_views.find((v) => v.id === selectedViewId) ?? null;

  const hidden = useMemo(() => {
    if (!campaign) return [];
    const layoutKeys = new Set((currentLayout ?? []).map((it) => it.i));
    return viewCollections(campaign.imagery_sources, view).filter(
      (entry) => !layoutKeys.has(String(entry.collection.id))
    );
  }, [campaign, view, currentLayout]);

  const hasVisibleWindows = useMemo(
    () => (currentLayout ?? []).some((it) => !isMainLayoutKey(it.i)),
    [currentLayout]
  );

  if (!isEditingLayout) return null;

  // Admins also manage views and source membership here; for everyone else
  // the panel is exactly the hidden-windows list it always was.
  const panelTitle = isCampaignAdmin ? 'Views & windows' : 'Hidden windows';

  const perRow = widthToPerRow(newWindowSize.w);

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: panelSize.width,
      height: panelSize.height,
    };
  };

  const onResizePointerMove = (e: React.PointerEvent) => {
    const start = resizeStart.current;
    if (!start) return;
    // Anchored bottom-right: dragging left/up enlarges the panel.
    const next = {
      width: clamp(start.width + (start.x - e.clientX), MIN_PANEL_W, MAX_PANEL_W),
      height: clamp(start.height + (start.y - e.clientY), MIN_PANEL_H, MAX_PANEL_H),
    };
    setPanelSize(next);
  };

  const onResizePointerUp = (e: React.PointerEvent) => {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    try {
      localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(panelSize));
    } catch {
      // ignore storage failures (private mode / quota)
    }
  };

  const countBadge = (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-neutral-200 px-1 text-[10px] font-semibold tabular-nums text-neutral-600">
      {hidden.length}
    </span>
  );

  // Collapsed chip - always rendered so the count stays visible.
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="fixed bottom-3 right-3 z-[1002] inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/95 px-3 py-2 text-xs font-medium text-neutral-700 shadow-lg ring-1 ring-black/5 backdrop-blur transition-colors hover:bg-white"
        title={`Show ${panelTitle.toLowerCase()}`}
      >
        <IconWindow className="w-4 h-4 text-neutral-500" />
        <span>{panelTitle}</span>
        {countBadge}
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-3 right-3 z-[1002] flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white/95 shadow-xl ring-1 ring-black/5 backdrop-blur"
      style={{ width: panelSize.width, maxHeight: panelSize.height }}
      data-testid="hidden-windows-panel"
    >
      {/* Resize handle (top-left) - grows the panel up/left into the viewport. */}
      <div
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        className="group absolute top-0 left-0 z-20 h-5 w-5 cursor-nwse-resize"
        title="Drag to resize panel"
        aria-label="Resize hidden windows panel"
        data-testid="resize-hidden-windows-panel"
      >
        <span className="absolute top-1.5 left-1.5 h-2 w-2 rounded-tl-[3px] border-l-2 border-t-2 border-neutral-300 transition-colors group-hover:border-brand-500" />
      </div>

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50/70 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2 pl-3">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-600">
            <IconWindow className="h-3.5 w-3.5" />
          </span>
          <span className="truncate text-xs font-semibold text-neutral-800">{panelTitle}</span>
          {countBadge}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700"
          aria-label="Minimize panel"
          title="Minimize"
        >
          <IconChevronDown className="h-4 w-4" />
        </button>
      </div>

      {/* Everything below the header scrolls as one body; with the admin
          sections present the content easily exceeds the panel max height. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Admin: view structure. Rendered above the window controls because
          everything below operates within the selected view. */}
        {isCampaignAdmin && campaign && (
          <div className="space-y-4 border-b border-neutral-100 px-3.5 py-3">
            <ViewManagerSection campaign={campaign} selectedViewId={selectedViewId} />
            {view && <ViewSourcesSection campaign={campaign} view={view} />}
          </div>
        )}

        {/* Controls */}
        <div className="space-y-3 border-b border-neutral-100 px-3.5 py-3">
          <div className="flex gap-2 rounded-lg border border-neutral-200/70 bg-neutral-50 px-2.5 py-2">
            <IconInfo className="mt-px h-3 w-3 shrink-0 text-neutral-400" />
            <p className="text-[11px] leading-snug text-neutral-500">
              Hide windows you don't need as dedicated views - their dates stay available in the
              timeline, and fewer windows load faster. Drag one onto the canvas to place it, or
              click Add for the next free slot.
            </p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={hideAllWindows}
            disabled={!hasVisibleWindows}
            leading={<IconEyeSlash className="h-3.5 w-3.5" />}
            className="w-full"
            data-testid="hide-all-windows"
          >
            Hide all windows
          </Button>

          {/* Size picker for newly-added windows. */}
          <div className="space-y-2" data-testid="new-window-size">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              New window size
            </span>
            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <label className="w-12 shrink-0 text-[11px] text-neutral-500">Per row</label>
                <input
                  type="range"
                  min={MIN_PER_ROW}
                  max={MAX_PER_ROW}
                  step={1}
                  value={perRow}
                  onChange={(e) =>
                    setNewWindowSize({
                      w: perRowToWidth(parseInt(e.target.value, 10)),
                      h: newWindowSize.h,
                    })
                  }
                  className="h-1.5 flex-1 cursor-pointer accent-brand-600"
                  aria-label="Windows per row"
                />
                <span className="w-5 text-right text-[11px] font-medium tabular-nums text-neutral-700">
                  {perRow}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <label className="w-12 shrink-0 text-[11px] text-neutral-500">Height</label>
                <input
                  type="range"
                  min={MIN_WINDOW_H}
                  max={MAX_WINDOW_H}
                  step={1}
                  value={clamp(newWindowSize.h, MIN_WINDOW_H, MAX_WINDOW_H)}
                  onChange={(e) =>
                    setNewWindowSize({ w: newWindowSize.w, h: parseInt(e.target.value, 10) })
                  }
                  className="h-1.5 flex-1 cursor-pointer accent-brand-600"
                  aria-label="Window height"
                />
                <span className="w-5 text-right text-[11px] font-medium tabular-nums text-neutral-700">
                  {newWindowSize.h}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Hidden list */}
        <div className="p-2">
          {hidden.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-6 text-center">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-neutral-400">
                <IconEye className="h-4 w-4" />
              </span>
              <p className="text-xs font-medium text-neutral-600">All windows visible</p>
              <p className="text-[11px] leading-snug text-neutral-400">
                Use the eye icon on a window header - or “Hide all” - to move windows here.
              </p>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {hidden.map(({ source, collection }) => (
                <li
                  key={collection.id}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    startWindowDrag(collection.id, e.clientX, e.clientY);
                  }}
                  className="group flex cursor-grab select-none items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-neutral-50 active:cursor-grabbing"
                  title={`Drag ${collection.name} onto the canvas, or click Add`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <IconDragHandle className="h-3.5 w-3.5 shrink-0 text-neutral-300 transition-colors group-hover:text-neutral-400" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-xs font-medium text-neutral-700">
                        {collection.name}
                      </span>
                      <span className="truncate text-[10px] text-neutral-400">{source.name}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => addWindow(collection.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-600 px-2 py-1 text-[11px] font-medium text-white opacity-90 transition hover:bg-brand-700 hover:opacity-100"
                    aria-label={`Add ${collection.name} back to layout`}
                  >
                    <IconPlus className="h-3 w-3" />
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
