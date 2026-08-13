import { createElement } from 'react';
import type { Feature } from '../../composition';
import { CurrentTaskClaimBadge } from './ClaimBadge';
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
            header: createElement(CurrentTaskClaimBadge),
            body: createElement(TaskControlsPanel, { ctx }),
          },
        ]
      : [],
  hotkeys: (ctx) => taskWorkHotkeys(ctx),
};

export { TaskControlsPanel } from './TaskControlsPanel';
export { LabelGrid, type LabelGridProps } from './LabelGrid';
export { ReviewList, type ReviewListProps } from './ReviewList';
export { ClaimBadge, CurrentTaskClaimBadge, type ClaimBadgeProps } from './ClaimBadge';
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
  formFieldDigitBindings,
  taskWorkHotkeys,
  taskLabellingPolicy,
  currentSubmitReadiness,
  submitAnnotation,
  skipCurrent,
  submitAuthoritative,
  resetDigitBuffer,
  DEFAULT_CONFIDENCE,
  type TaskPolicy,
} from './hotkeys';
export {
  getCurrentTask,
  useTaskSessionStore,
  type InitializeTaskSession,
  type TaskSessionState,
} from './taskSession.store';
