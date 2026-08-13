export { Canvas } from './Canvas';
export { PanelHost, PANEL_DRAG_HANDLE_CLASS, PANEL_DRAG_CANCEL_SELECTOR } from './PanelHost';
export type { PanelHostProps } from './PanelHost';
export { useContainerSize } from './useContainerSize';
export type { ContainerSize } from './useContainerSize';
export { GRID_COLS, ROW_HEIGHT, GRID_MARGIN } from './types';
export type { LayoutItem, PanelDef, CanvasProps } from './types';
export { nextFreeSlot, resolveDropCell, cellToPixelRect } from './geometry';
export type { Point, CanvasRect } from './geometry';

export { withoutKeys, packItem, scaleWidthToScreen, mergeLayoutChange } from './popout/scale';
export {
  EMPTY_SCREENS,
  open as openScreen,
  close as closeScreen,
  sendTo as sendToScreen,
  returnPanel as returnPanelFromScreen,
  rememberBounds as rememberScreenBounds,
  serialize as serializeScreens,
  restore as restoreScreens,
} from './popout/screens';
export type { ScreenBounds, ScreenDef, ScreensState } from './popout/screens';
export { ScreenWindow } from './popout/ScreenWindow';
export type {
  PopoutWindowComponentProps,
  ScreenWindowBounds,
  ScreenWindowProps,
} from './popout/ScreenWindow';

export { HiddenTray } from './hiddenTray/HiddenTray';
export type { HiddenTrayItem, HiddenTrayProps } from './hiddenTray/HiddenTray';
export { step as stepDragOut, MOVE_THRESHOLD_PX } from './hiddenTray/dragOut';
export type { DragOutEvent, DragOutGeometry, DragOutState } from './hiddenTray/dragOut';
