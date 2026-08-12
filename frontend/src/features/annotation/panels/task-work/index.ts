import { createElement } from 'react';
import type { Feature } from '../registry';
import { TaskControlsPanel } from './TaskControlsPanel';
import { taskWorkHotkeys } from './hotkeys';

export const TASK_CONTROLS_PANEL_ID = 'task-controls';

export const taskWorkFeature: Feature = {
  panels: (ctx) =>
    ctx.mode === 'tasks'
      ? [
          {
            id: TASK_CONTROLS_PANEL_ID,
            title: 'Task',
            body: createElement(TaskControlsPanel, { ctx }),
          },
        ]
      : [],
  // taskWorkHotkeys decides per scope which tables a mode gets: the 'mode'
  // table is tasks-only (Explore claims the same keys), the 'form' table
  // serves both modes' custom fields.
  hotkeys: (ctx) => taskWorkHotkeys(ctx),
};

export { TaskControlsPanel } from './TaskControlsPanel';
export { LabelGrid, type LabelGridProps } from './LabelGrid';
export { ReviewList, type ReviewListProps } from './ReviewList';
export { ClaimBadge, type ClaimBadgeProps } from './ClaimBadge';
export {
  useClaims,
  claimTask,
  CLAIM_RENEW_MS,
  type ClaimResult,
  type ClaimStatus,
} from './useClaims';
export { submitCurrent, type SubmitParams, type SubmitOutcome } from './submit';
export {
  taskWorkBindings,
  taskFormBindings,
  taskWorkHotkeys,
  taskLabellingPolicy,
  submitAnnotation,
  skipCurrent,
  submitAuthoritative,
  resetDigitBuffer,
  DEFAULT_CONFIDENCE,
  type TaskPolicy,
} from './hotkeys';
export {
  getCurrentTask,
  getTaskListState,
  deriveMapFocus,
  syncMapFocus,
  initTaskList,
  goToAnnotationNumber,
  goToIndex,
  next,
  previous,
  replaceTask,
  resetTaskList,
  setFilter,
  setSubmitting,
  setKnnValidationEnabled,
  useTaskListState,
  type TaskListState,
} from './taskListBus';
export {
  requestConfirm,
  resolveConfirm,
  useConfirmDialogState,
  isSkipConfirmDisabled,
  setSkipConfirmDisabled,
  type ConfirmRequest,
  type ConfirmDialogState,
} from './confirmBus';
