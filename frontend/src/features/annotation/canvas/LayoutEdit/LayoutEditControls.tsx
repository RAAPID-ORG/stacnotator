import { useState } from 'react';
import {
  createNewCanvasLayout,
  type CampaignOutFull,
  type CanvasLayoutItem,
  type ImageryViewOut,
} from '~/api/client';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { IconLayoutGrid } from '~/shared/ui/Icons';
import { useLayoutStore as useAppLayoutStore } from '~/shared/stores/layout.store';
import { useIsMobile } from '~/shared/utils/useIsMobile';
import { useLayoutStore } from '../../stores/layout';
import { fromGridLayout } from '../grid';
import { SaveDialogs } from './SaveDialogs';

export interface LayoutEditControlsProps {
  campaign: CampaignOutFull;
  view: ImageryViewOut | null;
  isCampaignAdmin: boolean;
  /** The first view's initial edit must establish the layout seen by everyone. */
  mustSaveDefault?: boolean;
  onDefaultSaved?: () => void;
}

export function LayoutEditControls({
  campaign,
  view,
  isCampaignAdmin,
  mustSaveDefault = false,
  onDefaultSaved,
}: LayoutEditControlsProps) {
  const isMobile = useIsMobile();
  const showAlert = useAppLayoutStore((s) => s.showAlert);
  const editing = useLayoutStore((s) => s.editing);
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const savedLayout = useLayoutStore((s) => s.savedLayout);
  const startEditing = useLayoutStore((s) => s.startEditing);
  const saveLayout = useLayoutStore((s) => s.saveLayout);
  const cancelEditing = useLayoutStore((s) => s.cancelEditing);
  const setLayout = useLayoutStore((s) => s.setLayout);

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
    const viewLayoutData: CanvasLayoutItem[] = Object.values(currentLayout.windows);
    // Do not rely on the save menu alone to uphold first-view setup: even if a
    // caller asks for a personal save, the initial layout must be shared.
    const saveAsDefault = mustSaveDefault || shouldBeDefault;
    try {
      await createNewCanvasLayout({
        path: { campaign_id: campaign.id },
        body: {
          view_id: view.id,
          should_be_default: saveAsDefault,
          layout: { main_layout_data: mainLayoutData, view_layout_data: viewLayoutData },
        },
      });
      saveLayout();
      if (saveAsDefault) onDefaultSaved?.();
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
    // The mobile canvas is a static synthetic stack (canvas/grid mobileStack),
    // not the draggable grid, so edit mode is unreachable there. Gating on
    // `useIsMobile` rather than a CSS class since there is nothing to fall
    // back to on mobile if editing were somehow entered anyway.
    if (isMobile) return null;
    return (
      <button
        type="button"
        onClick={startEditing}
        title="Edit canvas layout and panels"
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 rounded transition-all"
        data-testid="edit-layout-trigger"
      >
        <IconLayoutGrid className="w-3.5 h-3.5" />
        Edit Layout
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 bg-neutral-50 rounded px-1">
      <SaveDialogs
        currentLayout={currentLayout}
        savedLayout={savedLayout}
        viewsCount={campaign.imagery_views.length}
        canSaveDefault={isCampaignAdmin}
        mustSaveDefault={mustSaveDefault}
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
