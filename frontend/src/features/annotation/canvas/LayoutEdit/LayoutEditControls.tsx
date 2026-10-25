import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { saveCanvasLayout, type CampaignOutFull, type ImageryViewOut } from '~/api/client';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { Button } from '~/shared/ui/forms';
import { BarButton } from '~/shared/ui/BarButton';
import { IconLayoutGrid } from '~/shared/ui/Icons';
import { useLayoutStore as useAppLayoutStore } from '~/shared/stores/layout.store';
import { useIsMobile } from '~/shared/utils/useIsMobile';
import { useLayoutStore } from '../../stores/layout';
import { EMPTY_LAYOUT, fromGridLayout, toGridLayout } from '../grid';
import { SaveDialogs } from './SaveDialogs';

export interface LayoutEditControlsProps {
  campaign: CampaignOutFull;
  view: ImageryViewOut | null;
  isCampaignAdmin: boolean;
  /** The first view's initial edit must establish the layout seen by everyone. */
  mustSaveDefault?: boolean;
  /** First-view setup is over - either the shared layout was saved, or the
   *  admin backed out and the server-seeded default stands. */
  onSetupFinished?: () => void;
}

export function LayoutEditControls({
  campaign,
  view,
  isCampaignAdmin,
  mustSaveDefault = false,
  onSetupFinished,
}: LayoutEditControlsProps) {
  const { t } = useTranslation(['annotation', 'common']);
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
    const mainLayoutData = toGridLayout({ main: currentLayout.main, windows: {}, hidden: [] });
    const viewLayoutData = Object.values(currentLayout.windows);
    const viewHidden = currentLayout.hidden.map(String);
    // Do not rely on the save menu alone to uphold first-view setup: even if a
    // caller asks for a personal save, the initial layout must be shared.
    const saveAsDefault = mustSaveDefault || shouldBeDefault;
    try {
      await saveCanvasLayout({
        path: { campaign_id: campaign.id },
        body: {
          view_id: view.id,
          should_be_default: saveAsDefault,
          layout: {
            main_layout_data: mainLayoutData,
            view_layout_data: viewLayoutData,
            view_hidden: viewHidden,
          },
        },
      });
      saveLayout();
      if (saveAsDefault) onSetupFinished?.();
      showAlert(t('layoutEdit.saved'), 'success');
    } catch {
      showAlert(t('layoutEdit.saveFailed'), 'error');
    }
  };

  const handleReset = () => {
    setResetConfirmOpen(false);
    const mainItems = campaign.default_main_canvas_layout?.layout_data ?? [];
    const viewItems = view?.default_canvas_layout?.layout_data ?? [];
    setLayout(
      fromGridLayout([...mainItems, ...viewItems], {
        ...EMPTY_LAYOUT,
        hidden: (view?.default_canvas_layout?.hidden ?? []).map(Number),
      })
    );
    showAlert(t('layoutEdit.resetDone'), 'success');
  };

  if (!editing) {
    // The mobile canvas is a static synthetic stack (canvas/grid mobileStack),
    // not the draggable grid, so edit mode is unreachable there. Gating on
    // `useIsMobile` rather than a CSS class since there is nothing to fall
    // back to on mobile if editing were somehow entered anyway.
    if (isMobile) return null;
    return (
      <BarButton
        icon={IconLayoutGrid}
        label={t('layoutEdit.edit')}
        onClick={startEditing}
        title={t('layoutEdit.editTip')}
        data-testid="edit-layout-trigger"
        data-tour="layout-controls"
      />
    );
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-1" data-tour="layout-controls">
      <Button
        variant="quiet"
        size="sm"
        onClick={() => setResetConfirmOpen(true)}
        title={t('layoutEdit.resetTip')}
        className="mr-auto"
      >
        {t('layoutEdit.reset')}
      </Button>
      <Button
        variant="quiet"
        size="sm"
        onClick={() => {
          cancelEditing();
          if (mustSaveDefault) onSetupFinished?.();
        }}
        title={t('layoutEdit.cancelTip')}
      >
        {t('common:actions.cancel')}
      </Button>
      <SaveDialogs
        currentLayout={currentLayout}
        savedLayout={savedLayout}
        viewsCount={campaign.imagery_views.length}
        canSaveDefault={isCampaignAdmin}
        mustSaveDefault={mustSaveDefault}
        onSave={persistAndSave}
      />

      <ConfirmDialog
        isOpen={resetConfirmOpen}
        title={t('layoutEdit.resetConfirm.title')}
        description={t('layoutEdit.resetConfirm.description')}
        confirmText={t('layoutEdit.reset')}
        cancelText={t('common:actions.cancel')}
        onConfirm={handleReset}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </div>
  );
}
