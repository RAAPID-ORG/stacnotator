/**
 * The feature's front door. Everything else under `areaEstimation/` is
 * internal, the same rule the annotation feature follows.
 */
export { AreaEstimationTab } from './components/AreaEstimationTab';
export { AreaEstimationPanel } from './components/AreaEstimationPanel';
export {
  AREA_ESTIMATION_TASK_SET_NAME,
  LOCKED_TASK_SET_REASON,
  useAreaEstimationTaskSet,
} from './taskSet';
