import { useMemo } from 'react';
import ReactGridLayout, { getCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { PANEL_DRAG_CANCEL_SELECTOR, PANEL_DRAG_HANDLE_CLASS, PanelHost } from './PanelHost';
import { GRID_COLS, GRID_MARGIN, ROW_HEIGHT, type LayoutItem } from '../canvas/grid';
import type { PanelDef } from '../panels/panels';
import { useContainerSize } from '~/shared/hooks/useContainerSize';

export interface CanvasProps {
  panels: PanelDef[];
  layout: LayoutItem[];
  onLayoutChange?: (l: LayoutItem[]) => void;
  editing: boolean;
  onHidePanel?: (id: string) => void;
  fullscreen?: boolean;
  /** Handle on the scrolling grid container. The hidden tray resolves drop
   *  cells against this element's live rect and scroll offset, and it is the
   *  positioned ancestor its drop preview portals into. */
  outerRef?: React.RefObject<HTMLDivElement | null>;
  /** When set, the grid is static and uses this layout instead. */
  mobileLayout?: LayoutItem[];
}

const RESIZE_HANDLES = ['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne'] as const;
const DRAG_HANDLE_SELECTOR = `.${PANEL_DRAG_HANDLE_CLASS}`;

// Free positioning (no auto-compaction), overlap disallowed, and dragging
// into occupied space blocked - panels stay exactly where the user puts them.
const CANVAS_COMPACTOR = getCompactor(null, false, true);
const GRID_CONFIG = {
  cols: GRID_COLS,
  rowHeight: ROW_HEIGHT,
  margin: GRID_MARGIN,
  containerPadding: GRID_MARGIN,
};

/** The rearrangeable panel grid: wraps react-grid-layout with free
 *  positioning (no auto-compaction, so panels stay exactly where the user
 *  puts them) and PanelHost's header-only drag handle. Generic over
 *  arbitrary PanelDefs.
 **/
export function Canvas({
  panels,
  layout,
  onLayoutChange,
  editing,
  onHidePanel,
  fullscreen,
  outerRef,
  mobileLayout,
}: CanvasProps) {
  const { containerRef, width, isMounted } = useContainerSize();

  const setContainer = (node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (outerRef) outerRef.current = node;
  };

  const isStatic = mobileLayout != null;
  const effectiveLayout = isStatic ? mobileLayout : layout;
  const editingActive = editing && !isStatic;

  const panelsById = useMemo(() => new Map(panels.map((panel) => [panel.id, panel])), [panels]);

  // react-grid-layout memoizes against the *identity* of these config props, so
  // keep them stable across renders to avoid needlessly re-firing its effects.
  const dragConfig = useMemo(
    () => ({
      enabled: editingActive,
      handle: DRAG_HANDLE_SELECTOR,
      cancel: PANEL_DRAG_CANCEL_SELECTOR,
    }),
    [editingActive]
  );
  const resizeConfig = useMemo(
    () => ({ enabled: editingActive, handles: [...RESIZE_HANDLES] }),
    [editingActive]
  );

  return (
    <div
      ref={setContainer}
      data-tour="canvas"
      className={`relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${
        isStatic ? 'p-0' : fullscreen ? 'p-3' : 'p-1'
      } ${editingActive ? 'is-editing' : ''}`}
    >
      {isMounted && (
        <ReactGridLayout
          width={width}
          layout={effectiveLayout}
          gridConfig={GRID_CONFIG}
          dragConfig={dragConfig}
          resizeConfig={resizeConfig}
          compactor={CANVAS_COMPACTOR}
          onLayoutChange={
            !editingActive || !onLayoutChange
              ? undefined
              : (nextLayout) => onLayoutChange([...nextLayout])
          }
        >
          {effectiveLayout.flatMap((item: LayoutItem) => {
            const panel = panelsById.get(item.i);
            if (!panel) return [];
            return [
              <PanelHost
                key={item.i}
                panel={panel}
                editing={editingActive}
                onHidePanel={onHidePanel}
              />,
            ];
          })}
        </ReactGridLayout>
      )}
    </div>
  );
}
