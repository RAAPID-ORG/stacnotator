import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AnnotationTaskOut } from '~/api/client';
import { TaskLocationsMap } from './TaskLocationsMap';

vi.mock('../leafletBasemap', () => ({ addGlBasemap: () => undefined }));

// jsdom ships no 2D context, and the map now draws its points into a canvas.
// The assertions below count DOM nodes, so the drawing calls can be no-ops.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({}, { get: () => () => undefined })) as unknown as HTMLCanvasElement['getContext'];
});

const makeTasks = (count: number): AnnotationTaskOut[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    annotation_number: i + 1,
    task_set_id: 1,
    task_status: 'pending',
    geometry: { geometry: `POINT(${22 + (i % 100) * 0.1} ${45 + (i % 80) * 0.09})` },
    assignments: [],
    annotations: [],
  })) as unknown as AnnotationTaskOut[];

const bbox = { west: 22.1, south: 44.4, east: 40.2, north: 52.4 };

const nodesFor = (count: number) => {
  const { container, unmount } = render(<TaskLocationsMap tasks={makeTasks(count)} bbox={bbox} />);
  const nodes = container.querySelectorAll('*').length;
  unmount();
  return nodes;
};

describe('TaskLocationsMap', () => {
  it('does not put a DOM element on the page per task', () => {
    // A grid campaign holds five figures of tasks. One node each is what made
    // this map stall the tab: every pan repositions all of them.
    const few = nodesFor(100);
    const many = nodesFor(5000);

    expect(many - few).toBeLessThan(50);
  });

  it('still reports the totals beside the map', () => {
    const { getByText } = render(<TaskLocationsMap tasks={makeTasks(7)} bbox={bbox} />);

    expect(getByText(/task locations \(7 total\)/i)).toBeTruthy();
  });
});
