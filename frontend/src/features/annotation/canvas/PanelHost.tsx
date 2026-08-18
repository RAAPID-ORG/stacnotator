import { forwardRef, type HTMLAttributes } from 'react';
import type { PanelDef } from '../panels/panels';

/** react-grid-layout's `draggableHandle` / `draggableCancel` selectors: the
 *  header is the only drag surface, and interactive controls inside it never
 *  start a drag. Keeping the card body undraggable is what removes the need
 *  for stopPropagation workarounds and a hide-vs-drag distance heuristic. */
export const PANEL_DRAG_HANDLE_CLASS = 'panel-drag-handle';
export const PANEL_DRAG_CANCEL_SELECTOR = 'button, select, input, a';

interface PanelHostOwnProps {
  panel: PanelDef;
  editing: boolean;
  onHidePanel?: (id: string) => void;
}

// react-grid-layout clones its children (via GridItem/DraggableCore/
// Resizable) with `ref`, `className`, `style`, drag/resize event handlers,
// and resize-handle elements as `children` - so this must forward all of
// that onto a real DOM node rather than being a plain, closed component.
export type PanelHostProps = PanelHostOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, keyof PanelHostOwnProps>;

/** Renders one PanelDef as a canvas grid item: a header (the drag handle)
 *  and a body. In edit mode, panels flagged `hideTarget` swap their body for a
 *  placeholder instead of paying to render their (often expensive) real
 *  content while the layout is being rearranged. Whether that placeholder -
 *  and the small header action next to it - actually hides the panel is a
 *  separate question, `hidable`: the main map cannot be removed from the grid,
 *  but it still must not render live tiles behind a drag ghost. */
export const PanelHost = forwardRef<HTMLDivElement, PanelHostProps>(function PanelHost(
  { panel, editing, onHidePanel, className, style, children, ...rest },
  ref
) {
  const showPlaceholder = editing && panel.hideTarget === true;
  const canHide = panel.hidable === true && onHidePanel != null;
  const hideLabel = `Hide ${panel.title ?? panel.id}`;

  return (
    // data-panel-id is the panel's stable handle for anything that has to find
    // it in the DOM without knowing how it is styled - the guided tour's
    // spotlight resolves its targets through it rather than a CSS selector.
    <div
      ref={ref}
      data-panel-id={panel.id}
      data-panel-role={panel.role}
      data-tour={panel.id}
      className={`grid-card flex flex-col ${panel.className ?? ''} ${className ?? ''}`}
      style={style}
      {...rest}
    >
      <div
        className={`${PANEL_DRAG_HANDLE_CLASS} card-header flex items-center gap-2 ${editing ? 'editable' : ''}`}
        onClick={panel.onHeaderClick}
      >
        {panel.title && (
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium tracking-wider text-neutral-500 uppercase">
            {panel.title}
          </span>
        )}
        {panel.header}
        {editing && canHide && (
          <button
            type="button"
            // The header itself is the drag handle with its own onClick; without
            // stopping propagation here, a hide click also bubbles up and fires
            // panel.onHeaderClick. draggableCancel only stops RGL's drag start,
            // not React's click bubbling.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onHidePanel(panel.id);
            }}
            aria-label={hideLabel}
            title="Hide"
            data-testid={`hide-panel-${panel.id}`}
          >
            Hide
          </button>
        )}
      </div>

      {showPlaceholder ? (
        <button
          type="button"
          onClick={canHide ? () => onHidePanel?.(panel.id) : undefined}
          aria-label={canHide ? hideLabel : undefined}
          title={canHide ? hideLabel : (panel.title ?? panel.id)}
          disabled={!canHide}
          className="flex min-h-0 w-full flex-1 items-center justify-center"
          data-testid={canHide ? `hide-overlay-${panel.id}` : `edit-placeholder-${panel.id}`}
        >
          {canHide ? 'Hide panel' : (panel.title ?? panel.id)}
        </button>
      ) : (
        <div className="panel-body min-h-0 flex-1" onClick={panel.onBodyClick}>
          {panel.body}
        </div>
      )}

      {children}
    </div>
  );
});
