const REVEAL_OPTIONS: ScrollIntoViewOptions = {
  behavior: 'smooth',
  block: 'center',
  inline: 'nearest',
};

/** Keep keyboard navigation spatially legible inside scrollable panels. The
 * focus call suppresses its own browser scroll so it cannot undo the centered
 * reveal of the complete control group. */
export function revealAndFocus(
  container: HTMLElement | null,
  focusTarget: HTMLElement | null = container
): void {
  if (!container) return;
  container.scrollIntoView?.(REVEAL_OPTIONS);
  (focusTarget ?? container).focus({ preventScroll: true });
}
