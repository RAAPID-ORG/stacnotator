import type { MouseEvent, ReactNode } from 'react';
import { collectionsInView } from '~/features/annotation/core/catalog';
import { useImageryStore } from '~/features/annotation/stores';
import {
  IconChevronDoubleLeft,
  IconChevronDoubleRight,
  IconChevronLeft,
  IconChevronRight,
} from '~/shared/ui/Icons';
import type { ComposeCtx } from '../registry';

export interface MobileSliceNavProps {
  ctx: ComposeCtx;
}

export function MobileSliceNav({ ctx }: MobileSliceNavProps) {
  const address = useImageryStore((s) => s.address);
  const stepSlice = useImageryStore((s) => s.stepSliceAction);
  const stepCollection = useImageryStore((s) => s.stepCollectionAction);

  const collections = collectionsInView(ctx.catalog, { source_ids: ctx.view?.source_ids ?? [] });
  const sliceCount = address
    ? (ctx.catalog.collections.get(address.collectionId)?.slices.length ?? 0)
    : 0;

  const hasMultipleSlices = sliceCount > 1;
  const hasMultipleCollections = collections.length > 1;
  if (!hasMultipleSlices && !hasMultipleCollections) return null;

  // Map components capture touches on their container; without stopPropagation
  // a tap on the pill also pans the map underneath.
  const handle = (run: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    run();
  };

  return (
    <div
      // Fixed, not absolute: the composition root mounts this next to the
      // canvas, not inside the map container.
      className="pointer-events-auto fixed left-1/2 z-[450] flex -translate-x-1/2 items-stretch divide-x divide-neutral-100 overflow-hidden rounded-full border border-neutral-200 bg-white shadow-lg"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', touchAction: 'none' }}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      role="group"
      aria-label="Slice and collection navigation"
      data-testid="mobile-slice-nav"
    >
      {hasMultipleCollections && (
        <NavButton
          onClick={handle(() => stepCollection(ctx.catalog, -1))}
          label="Previous collection"
        >
          <IconChevronDoubleLeft className="h-5 w-5" />
        </NavButton>
      )}
      {hasMultipleSlices && (
        <NavButton onClick={handle(() => stepSlice(ctx.catalog, -1))} label="Previous slice">
          <IconChevronLeft className="h-5 w-5" />
        </NavButton>
      )}
      {hasMultipleSlices && (
        <NavButton onClick={handle(() => stepSlice(ctx.catalog, 1))} label="Next slice">
          <IconChevronRight className="h-5 w-5" />
        </NavButton>
      )}
      {hasMultipleCollections && (
        <NavButton onClick={handle(() => stepCollection(ctx.catalog, 1))} label="Next collection">
          <IconChevronDoubleRight className="h-5 w-5" />
        </NavButton>
      )}
    </div>
  );
}

function NavButton({
  onClick,
  label,
  children,
}: {
  onClick: (e: MouseEvent) => void;
  label: string;
  children: ReactNode;
}) {
  // 44x40 hits the iOS 44pt minimum on width with a comfortable height.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-11 items-center justify-center text-neutral-700 transition-colors active:bg-brand-50 active:text-brand-700"
    >
      {children}
    </button>
  );
}
