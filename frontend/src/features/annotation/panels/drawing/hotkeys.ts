import type { Binding } from '~/features/annotation/engine/hotkeys';
import type { ComposeCtx, HotkeyTable } from '../registry';
import { useWorkStore } from '~/features/annotation/stores';
import { clearEditSession, getEditSession } from '../shared/editSession';
import { commitEdit, deleteSelection } from './useDrawingInteractions';

export function drawingBindings(ctx: ComposeCtx): Binding[] {
  const hasSelection = () => useWorkStore.getState().selection.length > 0;

  return [
    {
      key: 'enter',
      help: 'Save the edited shape',
      when: () => getEditSession().pending !== null,
      run: () => void commitEdit(ctx.campaign.id),
    },
    {
      key: 'escape',
      help: 'Cancel the edit',
      when: hasSelection,
      run: clearEditSession,
    },
    {
      key: 'delete',
      help: 'Delete the selected annotation(s)',
      when: hasSelection,
      run: () => void deleteSelection(ctx.campaign.id),
    },
    {
      key: 'backspace',
      help: 'Delete the selected annotation(s)',
      when: hasSelection,
      run: () => void deleteSelection(ctx.campaign.id),
    },
  ];
}

export function drawingHotkeys(ctx: ComposeCtx): HotkeyTable[] {
  // Explore is the only mode with drawing tools; in tasks mode the table would
  // only shadow keys nothing here can act on.
  if (ctx.mode !== 'explore') return [];
  return [{ scope: 'drawing', table: drawingBindings(ctx) }];
}
