import { useState } from 'react';
import {
  createNewCanvasLayout,
  type CampaignOutFull,
  type CanvasLayoutItem,
  type ImageryViewOut,
} from '~/api/client';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useIsMobile } from '~/shared/utils/useIsMobile';
import { useWorkspaceStore } from '~/features/annotation/stores';
import { fromGridLayout } from '~/features/annotation/core/workspace';
import { SaveDialogs } from './SaveDialogs';

export interface EditControlsProps {
  campaign: CampaignOutFull;
  view: ImageryViewOut | null;
  isCampaignAdmin: boolean;
}

const MIN_PER_ROW = 2;
const MAX_PER_ROW = 10;
const MIN_WINDOW_H = 5;
const MAX_WINDOW_H = 20;

export function EditControls({ campaign, view, isCampaignAdmin }: EditControlsProps) {
  const isMobile = useIsMobile();
  const showAlert = useLayoutStore((s) => s.showAlert);
  const editing = useWorkspaceStore((s) => s.editing);
  const currentLayout = useWorkspaceStore((s) => s.currentLayout);
  const savedLayout = useWorkspaceStore((s) => s.savedLayout);
  const newWindowSize = useWorkspaceStore((s) => s.newWindowSize);
  const startEditing = useWorkspaceStore((s) => s.startEditing);
  const saveLayout = useWorkspaceStore((s) => s.saveLayout);
  const cancelEditing = useWorkspaceStore((s) => s.cancelEditing);
  const setLayout = useWorkspaceStore((s) => s.setLayout);
  const hideAllWindows = useWorkspaceStore((s) => s.hideAllWindows);
  const setNewWindowSize = useWorkspaceStore((s) => s.setNewWindowSize);

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const persistAndSave = async (shouldBeDefault: boolean) => {
    if (!view) {
      saveLayout();
      return;
    }
    const mainLayoutData: CanvasLayoutItem[] = [
      currentLayout.main.main,
      currentLayout.main.minimap,
      currentLayout.main.controls,
      ...Object.values(currentLayout.main.timeseries),
    ];
    const viewLayoutData: CanvasLayoutItem[] = Object.values(currentLayout.view.windows);
    try {
      await createNewCanvasLayout({
        path: { campaign_id: campaign.id },
        body: {
          view_id: view.id,
          should_be_default: shouldBeDefault,
          layout: { main_layout_data: mainLayoutData, view_layout_data: viewLayoutData },
        },
      });
      saveLayout();
      showAlert('Layout saved', 'success');
    } catch {
      showAlert('Failed to save layout', 'error');
    }
  };

  const handleReset = () => {
    setResetConfirmOpen(false);
    const mainItems = campaign.default_main_canvas_layout?.layout_data ?? [];
    const viewItems = view?.default_canvas_layout?.layout_data ?? [];
    setLayout(fromGridLayout([...mainItems, ...viewItems], currentLayout));
    showAlert('Layout reset to defaults', 'success');
  };

  if (!editing) {
    // The mobile canvas is a static synthetic stack (domain/workspace/mobile),
    // not the draggable grid, so edit mode is unreachable there. Gating on
    // `useIsMobile` rather than a CSS class since there is nothing to fall
    // back to on mobile if editing were somehow entered anyway.
    if (isMobile) return null;
    return (
      <button
        type="button"
        onClick={startEditing}
        title="Edit canvas layout and windows"
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 rounded transition-all"
        data-testid="edit-layout-trigger"
      >
        Edit Layout
      </button>
    );
  }

  const hasVisibleWindows = Object.keys(currentLayout.view.windows).length > 0;

  return (
    <div className="flex items-center gap-2 bg-neutral-50 rounded px-2 py-1">
      <SaveDialogs
        currentLayout={currentLayout}
        savedLayout={savedLayout}
        viewsCount={campaign.imagery_views.length}
        canSaveDefault={isCampaignAdmin}
        onSave={persistAndSave}
      />
      <button
        type="button"
        onClick={() => setResetConfirmOpen(true)}
        className="px-3 py-1 text-xs font-medium text-brand-800 hover:text-amber-600"
      >
        Reset
      </button>
      <button
        type="button"
        onClick={cancelEditing}
        className="px-3 py-1 text-xs font-medium text-brand-800 hover:text-red-600"
      >
        Cancel
      </button>

      <div className="w-px h-5 bg-neutral-200" />

      <button
        type="button"
        onClick={hideAllWindows}
        disabled={!hasVisibleWindows}
        className="px-2 py-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed"
        data-testid="hide-all-windows"
      >
        Hide all
      </button>

      <label className="flex items-center gap-1 text-[11px] text-neutral-500">
        Per row
        <input
          type="range"
          min={MIN_PER_ROW}
          max={MAX_PER_ROW}
          step={1}
          value={newWindowSize.perRow}
          onChange={(e) =>
            setNewWindowSize({ perRow: Number(e.target.value), rows: newWindowSize.rows })
          }
          className="h-1.5 w-16 cursor-pointer accent-brand-600"
          aria-label="Windows per row"
        />
        <span className="w-4 text-right font-medium tabular-nums text-neutral-700">
          {newWindowSize.perRow}
        </span>
      </label>
      <label className="flex items-center gap-1 text-[11px] text-neutral-500">
        Height
        <input
          type="range"
          min={MIN_WINDOW_H}
          max={MAX_WINDOW_H}
          step={1}
          value={newWindowSize.rows}
          onChange={(e) =>
            setNewWindowSize({ perRow: newWindowSize.perRow, rows: Number(e.target.value) })
          }
          className="h-1.5 w-16 cursor-pointer accent-brand-600"
          aria-label="Window height"
        />
        <span className="w-4 text-right font-medium tabular-nums text-neutral-700">
          {newWindowSize.rows}
        </span>
      </label>

      <ConfirmDialog
        isOpen={resetConfirmOpen}
        title="Reset Layout?"
        description="This will reset the canvas layout to the campaign defaults."
        confirmText="Reset"
        cancelText="Cancel"
        onConfirm={handleReset}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </div>
  );
}
