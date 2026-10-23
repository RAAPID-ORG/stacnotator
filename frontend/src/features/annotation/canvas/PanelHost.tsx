import { forwardRef, type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import type { PanelDef } from '../panels/panels';

/** Shared by both canvases and gesture recovery: interactive controls never
 *  start a drag, even when their containing panel body is draggable. */
export const PANEL_DRAG_HANDLE_CLASS = 'panel-drag-handle';
export const PANEL_DRAG_CANCEL_SELECTOR = 'button, select, input, textarea, label, a';

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

/** In edit mode, both the header and body can move a panel. Expensive bodies
 *  become a placeholder naming the panel; hidable panels keep an explicit
 *  header action. */
export const PanelHost = forwardRef<HTMLDivElement, PanelHostProps>(function PanelHost(
  { panel, editing, onHidePanel, className, style, children, ...rest },
  ref
) {
  const placeholder = editing ? panel.placeholder : undefined;
  // A headerless panel gets a header to drag by while editing, unless its
  // placeholder already fills the card and can be dragged itself.
  const showHeader = !panel.headerless || (editing && placeholder === undefined);
  const canHide = panel.hidable === true && onHidePanel != null;
  const { t } = useTranslation('annotation');
  const hideLabel = t('panelHost.hideLabel', { name: panel.title ?? panel.id });

  return (
    // data-panel-id is the panel's stable handle for anything that has to find
    // it in the DOM without knowing how it is styled - the guided tour's
    // spotlight resolves its targets through it rather than a CSS selector.
    <div
      ref={ref}
      data-panel-id={panel.id}
      data-panel-role={panel.role}
      data-tour={panel.id}
      // group/card: what a panel shows only while the pointer is over it - the
      // imagery window names its source that way - hangs off this.
      className={`grid-card group/card flex flex-col ${panel.className ?? ''} ${className ?? ''}`}
      style={style}
      {...rest}
    >
      {showHeader && (
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
              title={t('panelHost.hide')}
              data-testid={`hide-panel-${panel.id}`}
            >
              {t('panelHost.hide')}
            </button>
          )}
        </div>
      )}

      {placeholder ? (
        <div
          className={`${PANEL_DRAG_HANDLE_CLASS} flex min-h-0 w-full flex-1 cursor-move touch-none flex-col items-center justify-center gap-0.5 overflow-hidden p-2 text-center select-none`}
          data-testid={`edit-placeholder-${panel.id}`}
        >
          <span className="text-xs font-medium text-neutral-700">{placeholder.name}</span>
          <span className="text-[11px] text-neutral-500">{placeholder.description}</span>
        </div>
      ) : (
        <div
          className={`panel-body min-h-0 flex-1 ${editing ? `${PANEL_DRAG_HANDLE_CLASS} cursor-move touch-none` : ''}`}
          onClick={panel.onBodyClick}
        >
          {panel.body}
        </div>
      )}

      {children}
    </div>
  );
});
