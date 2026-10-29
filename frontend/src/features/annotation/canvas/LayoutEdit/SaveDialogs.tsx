import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDismissOnOutside } from '~/shared/hooks/useDismissOnOutside';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { Button } from '~/shared/ui/forms';
import { IconChevronDown } from '~/shared/ui/Icons';
import { mainLayoutChanged, type WorkspaceLayout } from '../grid';

export interface SaveDialogsProps {
  currentLayout: WorkspaceLayout;
  savedLayout: WorkspaceLayout;
  /** Number of imagery views in the campaign - the all-views warning only
   *  matters once more than one view shares the main chrome. */
  viewsCount: number;
  /** Whether "Save as default" is offered at all (campaign admins only). */
  canSaveDefault: boolean;
  /** During first-view setup, a personal layout is not a valid save target. */
  mustSaveDefault?: boolean;
  onSave: (shouldBeDefault: boolean) => void;
}

type PendingSave = { shouldBeDefault: boolean; step: 'confirmDefault' | 'confirmMainLayout' };

export function SaveDialogs({
  currentLayout,
  savedLayout,
  viewsCount,
  canSaveDefault,
  mustSaveDefault = false,
  onSave,
}: SaveDialogsProps) {
  const { t } = useTranslation(['annotation', 'common']);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<PendingSave | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside(containerRef, () => setMenuOpen(false), menuOpen);

  const proceedPastDefaultConfirm = (shouldBeDefault: boolean) => {
    if (mainLayoutChanged(currentLayout, savedLayout) && viewsCount > 1) {
      setPending({ shouldBeDefault, step: 'confirmMainLayout' });
      return;
    }
    onSave(shouldBeDefault);
  };

  const requestSave = (shouldBeDefault: boolean) => {
    setMenuOpen(false);
    // Nothing to confirm while setting up the first view: a shared layout is
    // the only thing that can be saved, and there is no existing one to lose.
    if (shouldBeDefault && !mustSaveDefault) {
      setPending({ shouldBeDefault, step: 'confirmDefault' });
      return;
    }
    proceedPastDefaultConfirm(shouldBeDefault);
  };

  return (
    <div ref={containerRef} className="relative" data-testid="save-dialogs">
      {mustSaveDefault ? (
        <Button size="sm" onClick={() => requestSave(true)} data-testid="save-required-default">
          {t('layoutEdit.saveLayout')}
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => setMenuOpen((open) => !open)}
          data-testid="save-menu-trigger"
        >
          {t('common:actions.save')}
          <IconChevronDown className="h-3.5 w-3.5" />
        </Button>
      )}
      {!mustSaveDefault && menuOpen && (
        <div
          className="absolute bottom-full right-0 mb-1 min-w-[160px] rounded-lg border border-neutral-200 bg-white shadow-lg z-20"
          data-testid="save-menu"
        >
          <button
            type="button"
            onClick={() => requestSave(false)}
            className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100"
            data-testid="save-personal"
          >
            <div className="font-medium">{t('layoutEdit.savePersonal')}</div>
            <div className="text-[10px] text-neutral-500">{t('layoutEdit.savePersonalHint')}</div>
          </button>
          {canSaveDefault && (
            <button
              type="button"
              onClick={() => requestSave(true)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 border-t border-neutral-200"
              data-testid="save-default"
            >
              <div className="font-medium">{t('layoutEdit.saveDefault')}</div>
              <div className="text-[10px] text-neutral-500">{t('layoutEdit.saveDefaultHint')}</div>
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={pending?.step === 'confirmDefault'}
        title={t('layoutEdit.confirmDefault.title')}
        description={t('layoutEdit.confirmDefault.description')}
        confirmText={t('layoutEdit.confirmDefault.confirm')}
        cancelText={t('common:actions.cancel')}
        isDangerous
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const { shouldBeDefault } = pending!;
          setPending(null);
          proceedPastDefaultConfirm(shouldBeDefault);
        }}
      />

      <ConfirmDialog
        isOpen={pending?.step === 'confirmMainLayout'}
        title={t('layoutEdit.confirmMain.title')}
        description={t('layoutEdit.confirmMain.description')}
        confirmText={t('layoutEdit.confirmMain.confirm')}
        cancelText={t('common:actions.cancel')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const { shouldBeDefault } = pending!;
          setPending(null);
          onSave(shouldBeDefault);
        }}
      />
    </div>
  );
}
