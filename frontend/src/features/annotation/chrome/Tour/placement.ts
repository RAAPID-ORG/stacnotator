import type { TourPlacement } from './engine';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Clearance between the tooltip and whatever it sits beside. */
const GAP = 16;
/** Smallest distance the tooltip is allowed to sit from the window edge. */
const EDGE = 12;

const ALL: TourPlacement[] = ['bottom', 'top', 'right', 'left'];

function overlap(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return x * y;
}

function beside(anchor: Box, size: Size, placement: TourPlacement): { left: number; top: number } {
  const midX = anchor.left + anchor.width / 2 - size.width / 2;
  const midY = anchor.top + anchor.height / 2 - size.height / 2;
  switch (placement) {
    case 'bottom':
      return { left: midX, top: anchor.top + anchor.height + GAP };
    case 'top':
      return { left: midX, top: anchor.top - size.height - GAP };
    case 'right':
      return { left: anchor.left + anchor.width + GAP, top: midY };
    case 'left':
      return { left: anchor.left - size.width - GAP, top: midY };
  }
}

function intoViewport(
  position: { left: number; top: number },
  size: Size,
  viewport: Size
): { left: number; top: number } {
  return {
    left: Math.max(EDGE, Math.min(position.left, viewport.width - size.width - EDGE)),
    top: Math.max(EDGE, Math.min(position.top, viewport.height - size.height - EDGE)),
  };
}

/** Last resort: a step that lights up a whole panel can leave no room on any of
 *  its sides, and a corner is still better than sitting on top of the thing the
 *  step is pointing at. */
function corners(size: Size, viewport: Size): Array<{ left: number; top: number }> {
  const right = viewport.width - size.width - EDGE;
  const bottom = viewport.height - size.height - EDGE;
  return [
    { left: EDGE, top: EDGE },
    { left: right, top: EDGE },
    { left: EDGE, top: bottom },
    { left: right, top: bottom },
  ].map((position) => intoViewport(position, size, viewport));
}

/**
 * Where to put the tooltip so it explains the thing it lights up rather than
 * covering it.
 *
 * `placement` is a preference, not an instruction: the first candidate that
 * covers nothing in `keepClear` wins, and if every one of them covers something
 * the one covering the smallest fraction wins. That is the whole point - a step
 * can light two panels at once, or sit beside a control the reader has to
 * reach, and the caller should not have to work out by hand which side happens
 * to be free at that size. Where a lit panel fills the screen and no candidate
 * is truly clear, this settles into the corner that clips the least off it.
 */
export function placeTooltip(
  anchor: Box | null,
  size: Size,
  keepClear: readonly Box[],
  viewport: Size,
  placement: TourPlacement = 'bottom'
): { left: number; top: number } {
  if (!anchor) {
    return {
      left: Math.max(EDGE, (viewport.width - size.width) / 2),
      top: Math.max(EDGE, (viewport.height - size.height) / 2),
    };
  }

  const preferred = [placement, ...ALL.filter((side) => side !== placement)];
  const candidates = [
    ...preferred.map((side) => intoViewport(beside(anchor, size, side), size, viewport)),
    ...corners(size, viewport),
  ];

  let best = candidates[0];
  let leastCovered = Infinity;
  for (const candidate of candidates) {
    const box = { ...candidate, width: size.width, height: size.height };
    // Scored as the fraction of each region covered, not raw area: clipping a
    // corner off a full-height map panel matters far less than sitting on the
    // small dropdown the step is asking the reader to look at.
    const covered = keepClear.reduce(
      (total, clear) => total + overlap(box, clear) / Math.max(1, clear.width * clear.height),
      0
    );
    if (covered === 0) return candidate;
    if (covered < leastCovered) {
      leastCovered = covered;
      best = candidate;
    }
  }
  return best;
}
