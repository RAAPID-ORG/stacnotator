import type { Binding } from '~/features/annotation/engine/hotkeys';
import { useWorkStore } from '~/features/annotation/stores';
import { useLayoutStore } from '~/shared/stores/layout.store';
import type { ComposeCtx, HotkeyTable } from '../../composition';
import { bumpAnnotationVersion } from '../../shared/annotationVersion';
import { getEditSession, saveAnnotationFlag } from '../../shared/editSession';
import { selectLabel, selectTool, type ActiveTool } from '../../shared/toolState';
import { formFieldDigitBindings } from '../task-work/hotkeys';

const TOOL_KEYS: Array<{ key: string; tool: ActiveTool; help: string }> = [
  { key: 'p', tool: 'pan', help: 'Pan tool' },
  { key: 'r', tool: 'annotate', help: 'Annotate tool' },
  { key: 'e', tool: 'edit', help: 'Edit tool' },
  { key: 'b', tool: 'labelVector', help: 'Label vector features' },
  { key: 't', tool: 'timeseries', help: 'Timeseries probe' },
];

function draftIsOpen(): boolean {
  return useWorkStore.getState().draft.phase === 'draft';
}

/** Save the open draft (Enter). A failure leaves it parked in the catalog
 *  with its answers, which is where the retry lives. */
async function commitOpenDraft(ctx: ComposeCtx): Promise<void> {
  const saved = await useWorkStore
    .getState()
    .commitDraft(ctx.campaign.id, ctx.campaign.settings.form_fields ?? []);
  if (saved) bumpAnnotationVersion();
  else {
    const { showAlert } = useLayoutStore.getState();
    showAlert('Could not save the annotation - check the required questions and retry.', 'error');
  }
}

export function exploreWorkBindings(ctx: ComposeCtx): Binding[] {
  const hasTimeseries = ctx.campaign.time_series.length > 0;
  const hasVectorLayers = (ctx.campaign.vector_layers?.length ?? 0) > 0;
  const labels = ctx.campaign.settings.labels;

  const toolBinding = ({ key, tool, help }: (typeof TOOL_KEYS)[number]): Binding => ({
    key,
    help,
    when: () => {
      if (tool === 'timeseries') return hasTimeseries;
      if (tool === 'labelVector') return hasVectorLayers;
      return true;
    },
    run: () => void selectTool(tool, ctx),
  });

  // A digit answers the questions catalog while one is open (old
  // useOpenModeKeyboard.ts:116 swallowed it there), so label selection only
  // takes digits when nothing is waiting to be saved. Explore has no
  // two-digit buffer, so only the single digits that name a real label (up to
  // 9) are bound.
  const digitBinding = (digit: string): Binding => ({
    key: digit,
    help: 'Select label by number',
    when: () => !draftIsOpen(),
    run: () => {
      const label = labels[Number(digit) - 1];
      if (label) selectLabel(label.id, ctx);
    },
  });
  const labelDigits = Array.from({ length: Math.min(labels.length, 9) }, (_, i) => String(i + 1));

  return [
    ...TOOL_KEYS.map(toolBinding),
    ...labelDigits.map(digitBinding),
    {
      key: 'f',
      help: 'Flag the selected annotation for review',
      when: () => getEditSession().annotation !== null,
      run: () => {
        const { annotation } = getEditSession();
        if (!annotation) return;
        void saveAnnotationFlag(
          ctx.campaign.id,
          !annotation.flagged_for_review,
          annotation.flag_comment ?? null
        );
      },
    },
    {
      key: 'enter',
      help: 'Save the drawn annotation',
      when: draftIsOpen,
      run: () => void commitOpenDraft(ctx),
    },
    {
      key: 'escape',
      help: 'Close the draft (incomplete answers discard it)',
      when: draftIsOpen,
      run: () => {
        void useWorkStore
          .getState()
          .closeDraft(ctx.campaign.id, ctx.campaign.settings.form_fields ?? [])
          .then((outcome) => {
            if (outcome === 'saved') bumpAnnotationVersion();
          });
      },
    },
  ];
}

export function exploreWorkHotkeys(ctx: ComposeCtx): HotkeyTable[] {
  if (ctx.mode !== 'explore') return [];
  return [
    { scope: 'mode', table: exploreWorkBindings(ctx) },
    // The digits alone, not task mode's whole form table: Escape and Enter
    // belong to the draft here (close it, save it), and the form scope outranks
    // the mode scope that holds them.
    { scope: 'form', table: formFieldDigitBindings(ctx) },
  ];
}
