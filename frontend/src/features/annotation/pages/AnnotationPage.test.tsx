import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampaignOutFull } from '~/api/client';
import { buildCatalog } from '~/features/annotation/core/catalog';
import {
  makeCampaign,
  makeCollection,
  makeSlice,
  makeSource,
  makeTileUrl,
  makeViz,
} from '~/features/annotation/core/catalog/testHelpers';
import { useWorkStore } from '~/features/annotation/stores';
import { selectWindowSlice } from '~/features/annotation/panels/imagery-windows';
import { useImageryStore } from '~/features/annotation/stores';
import { setProbePoint, useInteractionSpec } from '~/features/annotation/shared/interactionSpec';
import { mainCamera } from '~/features/annotation/shared/cameras';

/** loadCampaign's three calls, so the page can be driven without a server.
 *  `campaignFixture` is swapped per test before rendering. */
let campaignFixture: CampaignOutFull = makeCampaign();
const createImageryViewMock = vi.hoisted(() => vi.fn());

vi.mock('~/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/api/client')>()),
  createImageryView: createImageryViewMock,
  getCampaignWithImageryWindows: async () => ({ data: campaignFixture, status: 200 }),
  getAllAnnotationTasks: async () => ({ data: { tasks: [] }, status: 200 }),
  listTaskSets: async () => ({ data: [], status: 200 }),
}));

let mockCampaignId = 7;

vi.mock('~/api/tilerToken', () => ({
  ensureTilerSession: vi.fn(() => Promise.resolve()),
}));

vi.mock('~/shared/hooks/useCampaignIdParam', () => ({
  useCampaignIdParam: () => mockCampaignId,
}));
vi.mock('~/shared/hooks/useProjectIdParam', () => ({
  useProjectIdParam: () => 1,
}));
vi.mock('~/shared/stores/account.store', () => ({
  useAccountStore: (selector: (s: { account: { id: string } }) => unknown) =>
    selector({ account: { id: 'u1' } }),
}));
vi.mock('~/app/useCampaignBreadcrumbs', () => ({
  useCampaignBreadcrumbs: () => {},
}));
vi.mock('~/shared/utils/useIsMobile', async (importActual) => ({
  ...(await importActual<typeof import('~/shared/utils/useIsMobile')>()),
  useIsMobile: () => false,
}));

const setSearchParamsSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useSearchParams: (...args: Parameters<typeof actual.useSearchParams>) => {
      const [params] = actual.useSearchParams(...args);
      return [params, setSearchParamsSpy] as const;
    },
  };
});

// jsdom here ships no matchMedia, which every mobile-aware component calls.
vi.stubGlobal('matchMedia', (media: string) => {
  const target = new EventTarget();
  return {
    media,
    matches: false,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
});

vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

const { AnnotationPage } = await import('./AnnotationPage');

function renderPage(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AnnotationPage />
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  setSearchParamsSpy.mockClear();
  vi.restoreAllMocks();
  createImageryViewMock.mockReset();
});

describe('AnnotationPage gates', () => {
  it('holds a still-registering campaign behind a gate, with an admin bypass', async () => {
    campaignFixture = makeCampaign({ registration_status: 'registering', viewer_is_admin: true });
    mockCampaignId = 7;

    renderPage();

    await waitFor(() => expect(screen.getByTestId('registering-gate')).toBeDefined());
    expect(screen.getByText('Set up layout anyway')).toBeDefined();
    expect(screen.getByText(/Mosaic imagery is being prepared/)).toBeDefined();
    expect(screen.getByText(/checks progress automatically/)).toBeDefined();
  });

  it('polls mosaic registration and opens setup automatically when it finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    campaignFixture = makeCampaign({
      registration_status: 'registering',
      viewer_is_admin: true,
      imagery_sources: [makeSource({ id: 1 })],
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('registering-gate')).toBeDefined());

    campaignFixture = makeCampaign({
      registration_status: 'ready',
      viewer_is_admin: true,
      imagery_sources: [makeSource({ id: 1 })],
    });
    await vi.advanceTimersByTimeAsync(5000);

    await waitFor(() => expect(screen.getByTestId('no-views-gate')).toBeDefined());
  });

  it('offers no bypass to a non-admin', async () => {
    campaignFixture = makeCampaign({ registration_status: 'registering', viewer_is_admin: false });
    mockCampaignId = 7;

    renderPage();

    await waitFor(() => expect(screen.getByTestId('registering-gate')).toBeDefined());
    expect(screen.queryByText('Set up layout anyway')).toBeNull();
  });

  it('asks an admin to author the first view when the campaign has none', async () => {
    campaignFixture = makeCampaign({
      viewer_is_admin: true,
      imagery_sources: [makeSource({ id: 1, name: 'S2' })],
    });
    mockCampaignId = 7;

    renderPage();

    await waitFor(() => expect(screen.getByTestId('no-views-gate')).toBeDefined());
    expect(screen.getByTestId('create-first-view')).toBeDefined();
  });

  it('moves a newly created campaign to working zoom 15 when its first view is created', async () => {
    const source = makeSource({ id: 1, name: 'S2', default_zoom: 15 });
    const firstView = {
      id: 10,
      name: 'Default view',
      display_order: 0,
      source_ids: [source.id],
      default_canvas_layout: null,
      personal_canvas_layout: null,
    };
    campaignFixture = makeCampaign({
      viewer_is_admin: true,
      imagery_sources: [source],
    });
    createImageryViewMock.mockResolvedValue({ data: firstView, status: 201 });
    const moveTo = vi.spyOn(mainCamera, 'moveTo');

    renderPage();
    await waitFor(() => expect(screen.getByTestId('create-first-view')).toBeDefined());
    fireEvent.click(screen.getByTestId('create-first-view'));

    await waitFor(() => expect(screen.getByTestId('save-required-default')).toBeDefined());
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
    expect(moveTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 15 }));
  });

  it('tells an annotator to wait when the campaign has no views', async () => {
    campaignFixture = makeCampaign({ viewer_is_admin: false });
    mockCampaignId = 7;

    renderPage();

    await waitFor(() => expect(screen.getByTestId('no-views-gate')).toBeDefined());
    expect(screen.queryByTestId('create-first-view')).toBeNull();
  });

  it('consumes the deep-link query exactly once, on load', async () => {
    campaignFixture = makeCampaign({ registration_status: 'registering' });
    mockCampaignId = 7;

    renderPage('/?mode=explore&review=true');

    await waitFor(() => expect(screen.getByTestId('registering-gate')).toBeDefined());
    expect(setSearchParamsSpy).toHaveBeenCalledTimes(1);
    expect(setSearchParamsSpy).toHaveBeenCalledWith({}, { replace: true });
  });
});

// The cameras, the probe point, the per-window slice memory and the work store
// are all module-scope singletons that outlive any one campaign. Opening a
// second campaign must not inherit the first one's.
describe('AnnotationPage campaign switch', () => {
  it('leaves no draft, probe point or window slice memory from the previous campaign', async () => {
    campaignFixture = makeCampaign({ id: 1, registration_status: 'registering' });
    mockCampaignId = 1;
    const { rerender } = renderPage();
    await waitFor(() => expect(screen.getByTestId('registering-gate')).toBeDefined());

    // State the user builds up while working campaign 1.
    setProbePoint([3, 4]);
    const work = useWorkStore.getState();
    work.beginDraft(1);
    work.editDraftGeometry({ type: 'Point', coordinates: [0, 0] });
    work.setFormValues({ '1': 'answer' });
    const source = makeSource({
      id: 1,
      visualizations: [makeViz({ id: 1 })],
      collections: [
        makeCollection({
          id: 55,
          slices: Array.from({ length: 4 }, (_, index) =>
            makeSlice({ id: 550 + index, tile_urls: [makeTileUrl()] })
          ),
        }),
      ],
    });
    useImageryStore.setState({
      address: { sourceId: 1, collectionId: 55, sliceIndex: 0, vizId: '1' },
    });
    selectWindowSlice(
      buildCatalog(makeCampaign({ imagery_sources: [source] })),
      useImageryStore.getState(),
      55,
      3
    );
    expect(useImageryStore.getState().windowSlices[55]?.selected).toBe(3);
    expect(useImageryStore.getState().address?.sliceIndex).toBe(3);

    campaignFixture = makeCampaign({ id: 2, registration_status: 'registering' });
    mockCampaignId = 2;
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <AnnotationPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId('registering-gate')).toBeDefined());

    expect(useInteractionSpec.getState().probePoint).toBeNull();
    expect(useImageryStore.getState().windowSlices[55]).toBeUndefined();
    expect(useWorkStore.getState().draft.phase).toBe('idle');
    expect(useWorkStore.getState().formValues).toEqual({});
  });
});
