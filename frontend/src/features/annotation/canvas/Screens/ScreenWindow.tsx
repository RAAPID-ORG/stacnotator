import { useMemo, type ComponentType, type ReactNode } from 'react';
import ReactGridLayout, { getCompactor } from 'react-grid-layout';
import { PANEL_DRAG_CANCEL_SELECTOR, PANEL_DRAG_HANDLE_CLASS, PanelHost } from '../PanelHost';
import { GRID_COLS, GRID_MARGIN, ROW_HEIGHT, type LayoutItem } from '../grid';
import type { PanelDef } from '../../panels/panels';
import { useContainerSize } from '~/shared/hooks/useContainerSize';

const RESIZE_HANDLES = ['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne'] as const;
const DRAG_HANDLE_SELECTOR = `.${PANEL_DRAG_HANDLE_CLASS}`;

// Free positioning (no auto-compaction), overlap disallowed, and dragging
// into occupied space blocked - panels stay exactly where the user puts them.
const SCREEN_COMPACTOR = getCompactor(null, false, true);
const GRID_CONFIG = {
  cols: GRID_COLS,
  rowHeight: ROW_HEIGHT,
  margin: GRID_MARGIN,
  containerPadding: GRID_MARGIN,
};

export interface ScreenWindowBounds {
  width: number;
  height: number;
  left?: number;
  top?: number;
}

/** The window portal is injected rather than imported: the engine knows how a
 *  screen arranges its panels, not which app component opens a window. */
export interface PopoutWindowComponentProps {
  title: string;
  bounds: ScreenWindowBounds;
  /** The window is gone - closed by the user, or never opened at all. */
  onUserClose: () => void;
  /** The browser refused the popup; the caller decides how to say so.
   *  `onUserClose` fires straight after it, so a blocked window is a closed one. */
  onBlocked?: () => void;
  /** The window's last observed position and size. */
  onBounds?: (bounds: ScreenWindowBounds) => void;
  /** Label of the window's own close control. */
  closeLabel?: string;
  children: ReactNode;
}

export interface ScreenWindowProps {
  screenId: number;
  /** Panels currently assigned to this screen. */
  panels: PanelDef[];
  layout: LayoutItem[];
  editing: boolean;
  onLayoutChange?: (l: LayoutItem[]) => void;
  /** Same hide action the main canvas gives a card, so a window can be closed
   *  from wherever it is sitting. */
  onHidePanel?: (id: string) => void;
  onClose: () => void;
  bounds: ScreenWindowBounds;
  onBlocked?: () => void;
  onBounds?: (bounds: ScreenWindowBounds) => void;
  windowComponent: ComponentType<PopoutWindowComponentProps>;
}

type ScreenGridProps = Pick<
  ScreenWindowProps,
  'screenId' | 'panels' | 'layout' | 'editing' | 'onLayoutChange' | 'onHidePanel'
>;

/** Its own component because it measures the container it renders: the window
 *  component only mounts its children once the OS window exists, and a
 *  measuring hook living in `ScreenWindow` would run its mount effect one
 *  commit too early, against an element that is not in any document yet. */
function ScreenGrid({
  screenId,
  panels,
  layout,
  editing,
  onLayoutChange,
  onHidePanel,
}: ScreenGridProps) {
  const { containerRef, width, isMounted } = useContainerSize();

  const panelsById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  // Only render items both the layout and the assigned panel set agree on -
  // during a send/return the two update in separate renders.
  const renderableLayout = useMemo(
    () => layout.filter((it) => panelsById.has(it.i)),
    [layout, panelsById]
  );

  // react-grid-layout memoizes against the *identity* of these config props, so
  // keep them stable across renders to avoid needlessly re-firing its effects.
  const dragConfig = useMemo(
    () => ({ enabled: editing, handle: DRAG_HANDLE_SELECTOR, cancel: PANEL_DRAG_CANCEL_SELECTOR }),
    [editing]
  );
  const resizeConfig = useMemo(
    () => ({ enabled: editing, handles: [...RESIZE_HANDLES] }),
    [editing]
  );

  return (
    <div
      ref={containerRef}
      className={`annotation-workspace h-full overflow-y-auto overflow-x-hidden bg-base p-1 ${editing ? 'is-editing' : ''}`}
      data-testid={`popout-screen-${screenId}`}
    >
      {renderableLayout.length === 0 ? (
        <div className="flex h-full items-center justify-center px-6">
          <p className="max-w-sm text-center text-sm leading-relaxed text-neutral-400">
            This screen is empty. Send a panel here from the main canvas, then drag panels by their
            header to arrange them.
          </p>
        </div>
      ) : (
        isMounted && (
          <ReactGridLayout
            width={width}
            layout={renderableLayout}
            gridConfig={GRID_CONFIG}
            dragConfig={dragConfig}
            resizeConfig={resizeConfig}
            compactor={SCREEN_COMPACTOR}
            onLayoutChange={
              editing && onLayoutChange
                ? (nextLayout) => onLayoutChange([...nextLayout])
                : undefined
            }
          >
            {renderableLayout.map((item) => {
              const panel = panelsById.get(item.i);
              if (!panel) return null;
              return (
                <PanelHost key={item.i} panel={panel} editing={editing} onHidePanel={onHidePanel} />
              );
            })}
          </ReactGridLayout>
        )
      )}
    </div>
  );
}

/** A secondary canvas hosted in a pop-out window: its own grid of panels,
 *  with the same free-compaction rules and header-only drag handle as the
 *  main Canvas, via the shared PanelHost handle/cancel selectors. ScreenWindow
 *  only arranges the same panel definitions the main canvas uses. */
export function ScreenWindow({
  screenId,
  panels,
  layout,
  editing,
  onLayoutChange,
  onHidePanel,
  onClose,
  bounds,
  onBlocked,
  onBounds,
  windowComponent: WindowComponent,
}: ScreenWindowProps) {
  return (
    <WindowComponent
      title={`Screen ${screenId}`}
      bounds={bounds}
      onUserClose={onClose}
      onBlocked={onBlocked}
      onBounds={onBounds}
      closeLabel="Return all cards"
    >
      <ScreenGrid
        screenId={screenId}
        panels={panels}
        layout={layout}
        editing={editing}
        onLayoutChange={onLayoutChange}
        onHidePanel={onHidePanel}
      />
    </WindowComponent>
  );
}
