import { useEffect, useRef, type RefObject } from 'react';

type ElementRef = RefObject<HTMLElement | null>;

export function isOutside(target: Node | null, elements: (HTMLElement | null)[]): boolean {
  if (!target) return true;
  return !elements.some((element) => element?.contains(target));
}

/**
 * Dismisses an open menu or popover on a pointerdown outside all `refs` or on
 * Escape. Pass the trigger and, when the surface is portalled out of the
 * trigger's subtree, its panel - a press inside any of them counts as inside.
 * Listeners bind to the owning document, so popped-out windows work too.
 */
export function useDismissOnOutside(
  refs: ElementRef | ElementRef[],
  onDismiss: () => void,
  enabled: boolean
): void {
  const latest = useRef({ refs, onDismiss });
  latest.current = { refs, onDismiss };

  useEffect(() => {
    if (!enabled) return;

    const elements = () => {
      const { refs: current } = latest.current;
      return (Array.isArray(current) ? current : [current]).map((ref) => ref.current);
    };

    const doc = elements().find((element) => element)?.ownerDocument ?? document;

    const onPointerDown = (event: Event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (isOutside(target, elements())) latest.current.onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') latest.current.onDismiss();
    };

    doc.addEventListener('pointerdown', onPointerDown);
    doc.addEventListener('keydown', onKeyDown);
    return () => {
      doc.removeEventListener('pointerdown', onPointerDown);
      doc.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);
}
