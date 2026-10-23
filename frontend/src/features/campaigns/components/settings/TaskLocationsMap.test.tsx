import { screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTaskDensity } from '~/api/client/sdk.gen';
import { renderWithQuery } from '~/shared/testing/renderWithQuery';
import { TaskLocationsMap } from './TaskLocationsMap';

vi.mock('~/api/client/sdk.gen', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTaskDensity: vi.fn(),
}));

// jsdom ships no 2D context, no ResizeObserver and lays nothing out, so the map draws
// into a canvas it cannot paint and would report NaN bounds. All are given just enough
// to behave.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({}, { get: () => () => undefined })) as unknown as HTMLCanvasElement['getContext'];
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
});

const bbox = { west: 22.1, south: 44.4, east: 40.2, north: 52.4 };
const counts = { pending: 11908, partial: 0, conflicting: 0, done: 327, skipped: 0 };

const renderMap = () =>
  renderWithQuery(
    <TaskLocationsMap
      campaignId={117}
      statusCounts={counts}
      totalTasks={12235}
      bbox={bbox}
      taskSetId={54}
    />
  );

describe('TaskLocationsMap', () => {
  beforeEach(() => {
    vi.mocked(getTaskDensity).mockResolvedValue({
      data: [
        { lon: 34.5, lat: 45.4, task_status: 'done', label_id: 1, count: 5 },
        { lon: 30.0, lat: 48.0, task_status: 'pending', label_id: null, count: 900 },
      ],
    } as unknown as Awaited<ReturnType<typeof getTaskDensity>>);
  });

  it('shows campaign totals per status, not the counts of the fetched window', () => {
    renderMap();

    expect(screen.getByText(/task locations \(12235 total\)/i)).toBeTruthy();
    expect(screen.getByText(/pending \(11,908\)/i)).toBeTruthy();
    expect(screen.getByText(/complete \(327\)/i)).toBeTruthy();
  });
});
