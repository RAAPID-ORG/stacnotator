import type { Feature } from '../registry';
import { drawingHotkeys } from './hotkeys';

export const drawingFeature: Feature = {
  hotkeys: (ctx) => drawingHotkeys(ctx),
};

export { EditOverlayControls, type EditOverlayControlsProps } from './EditOverlayControls';
export { drawingBindings, drawingHotkeys } from './hotkeys';
export {
  commitEdit,
  deleteSelection,
  handleMapClick,
  useDrawingInteractions,
} from './useDrawingInteractions';
export {
  annotationBody,
  labelFeature,
  labelFeaturesInBox,
  type LabelBoxParams,
  type LabelFeatureParams,
  type LabelOutcome,
} from './vectorLabel';
