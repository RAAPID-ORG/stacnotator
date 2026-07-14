import { useMemo, type ReactNode } from 'react';
import ReactGridLayout, { getCompactor, type Layout } from 'react-grid-layout';
import { usePopoutStore } from '../stores/popout.store';
import { useContainerWidth } from '../hooks/useContainerWidth';
import { IconChevronLeft } from '~/shared/ui/Icons';

export interface ScreenCard {
  key: string;
  title: string;
  /** Replaces the default title span in the card header (e.g. the minimap
   *  coordinates row or an imagery window's name + slice select). */
  headerContent?: ReactNode;
  headerClassName?: string;
  onHeaderClick?: () => void;
  body: ReactNode;
}

// Same geometry as the main canvas so card sizes transfer 1:1; own compactor
// instance because react-grid-layout memoizes on its identity per grid.
const SCREEN_COMPACTOR = getCompactor(null, false, true);
const RESIZE_HANDLES = ['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne'] as const;
const GRID_CONFIG = { cols: 60, rowHeight: 15, margin: [6, 6] as [number, number] };
// Screens are always arrangeable - placing panels is their whole purpose, and
// there is no saved layout to protect (screen layouts are session-only).
// `cancel` keeps interactive header elements (return button, slice select)
// from starting a drag, which would swallow their clicks.
const DRAG_CONFIG = {
  enabled: true,
  handle: '.screen-drag-handle',
  cancel: 'button, select, input, a',
};
const RESIZE_CONFIG = { enabled: true, handles: [...RESIZE_HANDLES] };

/** A secondary canvas hosted in a pop-out window: its own grid of cards,
 *  freely arrangeable, with a per-card control to send the card back. */
export const PopoutScreen = ({ screenId, cards }: { screenId: number; cards: ScreenCard[] }) => {
  const layout = usePopoutStore((s) => s.screenLayouts[screenId]);
  const setScreenLayout = usePopoutStore((s) => s.setScreenLayout);
  const sendCard = usePopoutStore((s) => s.sendCard);
  const { containerRef, containerWidth, isMounted } = useContainerWidth();

  // Only render items the layout knows about, and vice versa - during a
  // send/return the two stores update in separate renders.
  const layoutKeys = useMemo(() => new Set((layout ?? []).map((it) => it.i)), [layout]);
  const renderable = cards.filter((c) => layoutKeys.has(c.key));
  const effectiveLayout: Layout = (layout ?? []).filter((it) => cards.some((c) => c.key === it.i));

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto overflow-x-hidden bg-base p-1"
      data-testid={`popout-screen-${screenId}`}
    >
      {renderable.length === 0 ? (
        <div className="flex h-full items-center justify-center px-6">
          <p className="max-w-sm text-center text-sm leading-relaxed text-neutral-400">
            This screen is empty. In the main window, hover a panel and use its send-to-screen
            button to move it here, then drag panels by their header to arrange them.
          </p>
        </div>
      ) : (
        isMounted && (
          <ReactGridLayout
            width={containerWidth}
            layout={effectiveLayout}
            gridConfig={GRID_CONFIG}
            dragConfig={DRAG_CONFIG}
            resizeConfig={RESIZE_CONFIG}
            compactor={SCREEN_COMPACTOR}
            onLayoutChange={(l) => setScreenLayout(screenId, l)}
          >
            {renderable.map((card) => (
              <div key={card.key} className="grid-card">
                <div
                  className={`screen-drag-handle card-header cursor-grab active:cursor-grabbing ${card.headerClassName ?? ''}`}
                  onClick={card.onHeaderClick}
                >
                  {card.headerContent ?? (
                    <span className="min-w-0 flex-1 truncate">{card.title}</span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      sendCard(card.key, null);
                    }}
                    title={`Return ${card.title} to the main window`}
                    aria-label={`Return ${card.title} to the main window`}
                    data-testid={`return-${card.key}`}
                    className="grid h-5 w-5 shrink-0 place-items-center rounded text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700"
                  >
                    <IconChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
                {card.body}
              </div>
            ))}
          </ReactGridLayout>
        )
      )}
    </div>
  );
};
