import { useCampaignStore, useCatalog } from '../stores/campaign';
import type { MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { collectionsInView } from '../campaign/imagery';
import { useImageryStore } from '../stores/imagery';
import {
  IconChevronDoubleLeft,
  IconChevronDoubleRight,
  IconChevronLeft,
  IconChevronRight,
} from '~/shared/ui/Icons';

export function SliceNavigation({ mobile = false }: { mobile?: boolean }) {
  const { t } = useTranslation('annotation');
  const catalog = useCatalog();
  const view = useCampaignStore((s) => s.view);
  const address = useImageryStore((s) => s.address);
  const stepSlice = useImageryStore((s) => s.stepSliceAction);
  const stepCollection = useImageryStore((s) => s.stepCollectionAction);

  const collections = collectionsInView(catalog, view);
  const sliceCount = address
    ? (catalog.collections.get(address.collectionId)?.slices.length ?? 0)
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
      className={`pointer-events-auto left-1/2 flex -translate-x-1/2 items-center rounded-lg border border-neutral-200 bg-white/95 p-1 shadow-md backdrop-blur-sm ${
        mobile
          ? 'fixed z-[450] max-w-[calc(100vw-24px)] [&>button]:h-10 [&>button]:w-11'
          : 'absolute z-20 max-w-[calc(100%-16px)] [&>button]:h-7 [&>button]:w-7'
      }`}
      style={{
        bottom: mobile ? 'calc(env(safe-area-inset-bottom, 0px) + 12px)' : '8px',
        touchAction: 'none',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      role="group"
      aria-label={t('sliceNav.label')}
      data-testid="slice-navigation"
    >
      <NavButton
        onClick={handle(() => stepCollection(catalog, -1))}
        label={t('keymap.previousCollection')}
        disabled={!hasMultipleCollections}
      >
        <IconChevronDoubleLeft className="h-4 w-4" />
      </NavButton>
      <NavButton
        onClick={handle(() => stepSlice(catalog, -1))}
        label={t('keymap.previousSlice')}
        disabled={!hasMultipleSlices}
      >
        <IconChevronLeft className="h-4 w-4" />
      </NavButton>
      <NavButton
        onClick={handle(() => stepSlice(catalog, 1))}
        label={t('keymap.nextSlice')}
        disabled={!hasMultipleSlices}
      >
        <IconChevronRight className="h-4 w-4" />
      </NavButton>
      <NavButton
        onClick={handle(() => stepCollection(catalog, 1))}
        label={t('keymap.nextCollection')}
        disabled={!hasMultipleCollections}
      >
        <IconChevronDoubleRight className="h-4 w-4" />
      </NavButton>
    </div>
  );
}

function NavButton({
  onClick,
  label,
  children,
  disabled,
}: {
  onClick: (e: MouseEvent) => void;
  label: string;
  children: ReactNode;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className="flex shrink-0 cursor-pointer items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:bg-brand-50 active:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
