import { useRef, useState } from 'react';
import { useDismissOnOutside } from '~/shared/hooks/useDismissOnOutside';
import { ConfirmDialog } from '~/shared/ui/ConfirmDialog';
import { IconChevronDownFilled } from '~/shared/ui/Icons';
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

  const saveButtonClass =
    'flex items-center gap-1 rounded px-3 py-1 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors';

  return (
    <div ref={containerRef} className="relative" data-testid="save-dialogs">
      {mustSaveDefault ? (
        <button
          type="button"
          onClick={() => requestSave(true)}
          className={saveButtonClass}
          data-testid="save-required-default"
        >
          Save layout
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className={saveButtonClass}
          data-testid="save-menu-trigger"
        >
          Save
          <IconChevronDownFilled className="w-3 h-3" />
        </button>
      )}
      {!mustSaveDefault && menuOpen && (
        <div
          className="absolute top-full left-0 mt-1 min-w-[160px] rounded-lg border border-neutral-200 bg-white shadow-lg z-20"
          data-testid="save-menu"
        >
          <button
            type="button"
            onClick={() => requestSave(false)}
            className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100"
            data-testid="save-personal"
          >
            <div className="font-medium">Save as personal</div>
            <div className="text-[10px] text-neutral-500">Only for you</div>
          </button>
          {canSaveDefault && (
            <button
              type="button"
              onClick={() => requestSave(true)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 border-t border-neutral-200"
              data-testid="save-default"
            >
              <div className="font-medium">Save as default</div>
              <div className="text-[10px] text-neutral-500">For all users</div>
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={pending?.step === 'confirmDefault'}
        title="Save as Default Layout?"
        description="This overwrites the default layout for every member of this campaign who has no personal layout of their own. Your own personal layout, if you have one, is left alone - to adopt this as yours too, save it here, then hit Reset and save as personal."
        confirmText="Save Default"
        cancelText="Cancel"
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
        title="Main Layout Modified"
        description="You have modified the main layout (main map, timeseries, or minimap). This change applies to every imagery view in this campaign and may cause layouts to shift. Do you want to save this layout?"
        confirmText="Save Layout"
        cancelText="Cancel"
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
