import { fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';

/** The page captures annotator activity with React handlers on its root element
 *  rather than listeners on `document`, because panels can be popped out into a
 *  second browser window. Those panels are portals: they live in another
 *  document, but their events still travel up the React tree. If that ever
 *  stopped holding, anyone working on a second monitor would silently stop
 *  accruing time on task, so it is asserted here rather than assumed. */
describe('activity capture across popout windows', () => {
  const renderWithPopout = (onActivity: () => void) => {
    // An iframe stands in for the pop-out window: a separate document with its
    // own window object, which is what makes it a real test of portal event
    // propagation rather than of same-document bubbling.
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const popoutDoc = frame.contentDocument!;
    const mount = popoutDoc.createElement('div');
    popoutDoc.body.appendChild(mount);

    render(
      <div onPointerDownCapture={onActivity} onKeyDownCapture={onActivity}>
        <button data-testid="on-main-canvas">main</button>
        {createPortal(<button data-testid="on-popped-screen">popped</button>, mount)}
      </div>
    );

    return { popped: () => popoutDoc.querySelector('[data-testid="on-popped-screen"]')! };
  };

  it('sees activity on the main canvas', () => {
    const onActivity = vi.fn();
    renderWithPopout(onActivity);

    fireEvent.pointerDown(screen.getByTestId('on-main-canvas'));

    expect(onActivity).toHaveBeenCalled();
  });

  it('sees activity inside a panel popped out to another document', () => {
    const onActivity = vi.fn();
    const { popped } = renderWithPopout(onActivity);

    fireEvent.pointerDown(popped());

    expect(onActivity).toHaveBeenCalled();
  });

  it('sees keyboard activity from a popped-out panel', () => {
    const onActivity = vi.fn();
    const { popped } = renderWithPopout(onActivity);

    fireEvent.keyDown(popped(), { key: 'a' });

    expect(onActivity).toHaveBeenCalled();
  });
});
