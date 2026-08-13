import { create } from 'zustand';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { useWorkStore } from '~/features/annotation/stores';
import type { ComposeCtx } from '../composition';
import { setProbePoint } from './interactionSpec';

export type ActiveTool = 'pan' | 'annotate' | 'edit' | 'labelVector' | 'timeseries';

interface ToolState {
  tool: ActiveTool;
}

const useToolStore = create<ToolState>(() => ({ tool: 'pan' }));

export function useActiveTool(): ActiveTool {
  return useToolStore((s) => s.tool);
}

export function getActiveTool(): ActiveTool {
  return useToolStore.getState().tool;
}

/**
 * Switch tools. The tool changes immediately - the pointer must not lag a
 * click behind the button - and the draft is resolved afterwards: the
 * questions catalog belongs to the annotate tool, so leaving it saves a
 * complete draft and discards an incomplete one, exactly as Escape does. A
 * failed save leaves the draft parked (work store's closeDraft), and the
 * panel shows it for a retry whatever tool is selected by then.
 */
export async function selectTool(tool: ActiveTool, ctx: ComposeCtx): Promise<void> {
  const draftWasOpen = useWorkStore.getState().draft.phase === 'draft';
  useToolStore.setState({ tool });

  // Dropping the label on pan is Explore's "stop drawing"; in Tasks the
  // selected label is the answer waiting to be submitted, not a drawing arm.
  if (tool === 'pan' && ctx.mode === 'explore') useWorkStore.getState().setSelectedLabelId(null);
  if (tool !== 'timeseries') setProbePoint(null);

  if (tool !== 'annotate' && draftWasOpen) {
    const outcome = await useWorkStore
      .getState()
      .closeDraft(ctx.campaign.id, ctx.campaign.settings.form_fields ?? []);
    // Parking the draft is only half the recovery: without a word the user
    // sees the tool change and assumes the annotation went with it.
    if (outcome === 'save-failed') {
      const { showAlert } = useLayoutStore.getState();
      showAlert(
        'Could not save the open annotation - it is still in the panel, retry there.',
        'error'
      );
    }
  }
}

/**
 * Arm or disarm the timeseries probe. Tasks mode has no tool palette to switch
 * away with - the probe button and its key are the only way back to pan, so
 * both toggle rather than latch.
 */
export function toggleTimeseriesTool(ctx: ComposeCtx): void {
  void selectTool(getActiveTool() === 'timeseries' ? 'pan' : 'timeseries', ctx);
}

/** Complete the one-shot probe without clearing the point it just produced.
 * A normal tool change still clears that point; completion is different
 * because the chart and marker must remain visible after the cursor returns
 * to navigation. */
export function completeTimeseriesProbe(ctx: ComposeCtx): void {
  if (getActiveTool() !== 'timeseries') return;
  useToolStore.setState({ tool: 'pan' });
  if (ctx.mode === 'explore') useWorkStore.getState().setSelectedLabelId(null);
}

/**
 * Pick the label the next gesture applies. Picking a label is how a user
 * starts drawing, so it arms the annotate tool - except in label-vector mode,
 * where the label applies to the features being clicked and switching away
 * would drop them.
 */
export function selectLabel(labelId: number, ctx: ComposeCtx): void {
  useWorkStore.getState().setSelectedLabelId(labelId);
  const tool = getActiveTool();
  if (tool !== 'annotate' && tool !== 'labelVector') void selectTool('annotate', ctx);
}

/** Test/teardown seam, mirrors task-work's resetTaskList. */
export function resetToolState(): void {
  useToolStore.setState({ tool: 'pan' });
}
