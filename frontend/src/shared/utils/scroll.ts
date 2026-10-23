/** The nearest ancestor that scrolls vertically. Scrolling it, rather than
 *  calling scrollIntoView, leaves every outer scroller - the page, the app
 *  shell, a canvas of panels - where it is. */
export function scrollableParent(from: HTMLElement | null): HTMLElement | null {
  for (let node = from?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}
