import type { Feature } from '../registry';

export const layoutEditFeature: Feature = {};

export { EditControls, type EditControlsProps } from './EditControls';
export { TrayContent, type TrayContentProps } from './TrayContent';
export { ViewAdmin, type ViewAdminProps } from './ViewAdmin';
export { SaveDialogs, type SaveDialogsProps } from './SaveDialogs';
export {
  layoutWithoutPopped,
  RestoreScreensToast,
  SCREEN_DEFAULT_BOUNDS,
  SendToScreenButton,
  useScreens,
  type RestoreScreensToastProps,
  type ScreensApi,
  type SendToScreenButtonProps,
} from './screens';
