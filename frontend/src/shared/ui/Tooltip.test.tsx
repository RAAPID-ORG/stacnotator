import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

// jsdom lays nothing out, so the trigger and the bubble get the sizes each test needs.
const measure = (trigger: DOMRect, bubbleHeight: number) => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const isTrigger = this.tagName === 'SPAN';
    return isTrigger ? trigger : ({ left: 0, top: 0, width: 256, height: bubbleHeight } as DOMRect);
  });
};

const rect = (top: number) => ({ left: 400, top, bottom: top + 16, width: 16 }) as DOMRect;

describe('Tooltip', () => {
  beforeEach(() => {
    window.innerHeight = 800;
    window.innerWidth = 1200;
  });

  it('hides the bubble when anything scrolls under it', () => {
    measure(rect(400), 60);
    const { container } = render(<Tooltip text="a long annotator comment" />);

    fireEvent.mouseEnter(container.querySelector('span')!);
    expect(screen.queryByText('a long annotator comment')).not.toBeNull();

    fireEvent.scroll(document, {});
    expect(screen.queryByText('a long annotator comment')).toBeNull();
  });

  it('flips a long comment below the trigger and caps it to the room there', () => {
    measure(rect(60), 600);
    const { container } = render(<Tooltip text="reasoning" />);

    fireEvent.mouseEnter(container.querySelector('span')!);

    const bubble = screen.getByText('reasoning');
    expect(bubble.style.maxHeight).toBe(`${800 - 76 - 6 - 8}px`);
    expect((bubble.parentElement as HTMLElement).style.top).toBe('82px');
  });

  it('keeps a bubble that does not fit above inside the viewport', () => {
    measure(rect(40), 200);
    const { container } = render(<Tooltip text="reasoning" />);

    fireEvent.mouseEnter(container.querySelector('span')!);

    // Room above (26px) is smaller than below, so it goes below rather than off-screen.
    expect((screen.getByText('reasoning').parentElement as HTMLElement).style.top).toBe('62px');
  });
});
