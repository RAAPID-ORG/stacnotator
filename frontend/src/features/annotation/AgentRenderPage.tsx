import { useEffect, useRef, useState } from 'react';
import {
  getCampaignWithImageryWindows,
  getCollections,
  type CampaignOutFull,
  type ImageryEditorStateCreate,
} from '~/api/client';
import { RUN_POLL_MS } from '~/api/queryClient';
import { authManager } from '~/features/auth';
import type { AuthAdapter } from '~/features/auth/core/authAdapter';
import { MPC_API_URL } from '~/features/layers/imagery/mpcPresets';
import {
  mergedImagery,
  setupOptions,
  type ImageryRecipe,
  type StacCollectionInfo,
} from '~/features/layers/imagery/recipe';
import { DEFAULT_BASEMAPS } from '~/features/layers/imagery/types';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { buildImageryCatalog } from './campaign/imagery';
import {
  locateProbe,
  offsetMeters,
  probeView,
  type ProbeInput,
  type ProbeOptions,
  type LocatedProbe,
} from './agents/probe';
import { hasMissingTiles, renderView, type RenderedImage } from './agents/render';
import {
  campaignContext,
  checkView,
  defaultViews,
  type AgentTask,
  type CampaignContext,
  type ImageLimits,
  type ViewSpec,
} from './agents/view';

type RenderedView = { view: ViewSpec } & (RenderedImage | { error: string });

const MAX_PROBES = 6;

interface AgentPageApi {
  context(): CampaignContext;
  defaultViews(): ViewSpec[];
  render(task: AgentTask, views: ViewSpec[], limits: ImageLimits): Promise<RenderedView[]>;
  locate(task: AgentTask, points: ProbeInput[]): LocatedProbe[];
  /** Draws in the background, one view at a time, so a later render is instant. */
  preload(tasks: AgentTask[], views: ViewSpec[], limits: ImageLimits): void;
  /** Time series at points the agent picked, beside the task's, with the map cells they
   *  were picked on redrawn with each point marked so the agent can check its aim. */
  probe(
    task: AgentTask,
    probes: ProbeInput[],
    options: ProbeOptions,
    limits: ImageLimits
  ): Promise<RenderedView>;
}

/** Expands imagery recipes into what the campaign wizard would have saved, for a new
 *  campaign (campaignId null) or merged into an existing campaign's imagery. */
interface AgentSetupApi {
  options(): ReturnType<typeof setupOptions>;
  imagery(
    campaignId: number | null,
    recipes: ImageryRecipe[],
    basemaps?: string[],
    remove?: string[]
  ): Promise<ImageryEditorStateCreate>;
}

declare global {
  interface Window {
    stacnotatorSetup?: AgentSetupApi;
    /** Exposed by the MCP server that opened the page: its SDK login. */
    stacnotatorToken?: () => Promise<string | null>;
    stacnotatorAgent?: AgentPageApi;
    stacnotatorAgentError?: string;
  }
}

const INJECTED_PROVIDER = 'injected';
const DRAWN_VIEWS_KEPT = 48;

const injectedTokenAdapter: AuthAdapter = {
  id: INJECTED_PROVIDER,
  login: async () => {
    throw new Error('A render page is signed in by the process that opens it');
  },
  logout: async () => {},
  isAuthenticated: () => !!window.stacnotatorToken,
  getIdToken: async () => {
    const token = await window.stacnotatorToken?.();
    if (!token) throw new Error('No token handed to the render page');
    return token;
  },
  onAuthStateChanged: () => () => {},
};

function createApi(campaign: CampaignOutFull, stage: HTMLElement): AgentPageApi {
  const catalog = buildImageryCatalog(campaign);
  const context = campaignContext(campaign);
  const drawn = new Map<string, Promise<RenderedView>>();

  const draw = (task: AgentTask, view: ViewSpec, limits: ImageLimits): Promise<RenderedView> => {
    const key = `${task.task_id}|${JSON.stringify(view)}|${JSON.stringify(limits)}`;
    const cached = drawn.get(key);
    if (cached) return cached;
    const pending = Promise.resolve()
      .then(() => {
        checkView(view);
        return renderView({ task, view, limits, campaign, catalog, stage });
      })
      .then(
        (image): RenderedView => {
          if (hasMissingTiles(image)) drawn.delete(key);
          return { view, ...image };
        },
        (err: unknown): RenderedView => {
          drawn.delete(key);
          return { view, error: extractErrorMessage(err, 'Rendering failed') };
        }
      );
    drawn.set(key, pending);
    if (drawn.size > DRAWN_VIEWS_KEPT) drawn.delete(drawn.keys().next().value!);
    return pending;
  };

  return {
    context: () => context,
    defaultViews: () => defaultViews(context),
    render: (task, views, limits) => Promise.all(views.map((view) => draw(task, view, limits))),
    locate: (task, points) => points.map((point) => locateProbe(task, point)),
    preload: (tasks, views, limits) => {
      void (async () => {
        for (const task of tasks) for (const view of views) await draw(task, view, limits);
      })();
    },
    probe: async (task, inputs, options, limits) => {
      let view: ViewSpec = { cells: [] };
      try {
        if (!inputs.length || inputs.length > MAX_PROBES)
          throw new Error(`probe 1-${MAX_PROBES} points`);
        const probes = inputs.map((input) => locateProbe(task, input));
        const ids = [
          ...new Set(options.timeseries_ids ?? context.timeseries.map((t) => t.timeseries_id)),
        ];
        if (!ids.length) throw new Error('this campaign has no time series');
        const unknown = ids.filter((id) => !campaign.time_series.some((t) => t.id === id));
        if (unknown.length) throw new Error(`unknown time series ${unknown.join(', ')}`);

        view = probeView(probes, ids, options, limits);
        checkView(view);
        const image = await renderView({
          task,
          view,
          limits,
          campaign,
          catalog,
          stage,
          probes,
        });
        const meta = {
          ...image.meta,
          probes: probes.map(({ lon, lat, from }, i) => ({
            probe: `P${i + 1}`,
            lat: Number(lat.toFixed(6)),
            lon: Number(lon.toFixed(6)),
            ...offsetMeters(task, lon, lat),
            ...(from ? { from } : {}),
          })),
        };
        return { view, ...image, meta };
      } catch (err) {
        return { view, error: extractErrorMessage(err, 'Probing failed') };
      }
    },
  };
}

const loadCampaign = (campaignId: number) =>
  getCampaignWithImageryWindows({ path: { campaign_id: campaignId }, throwOnError: true }).then(
    ({ data }) => data
  );

const imageryDue = (campaign: CampaignOutFull) =>
  campaign.registration_status === 'registering' ||
  (!!campaign.imagery_renew_at && Date.parse(campaign.imagery_renew_at) <= Date.now());

// The page stays open for a whole run, but MPC tile URLs expire: reading the campaign again
// when the backend says they are due renews them, and nothing is drawn until that is done.
function renewingApi(first: CampaignOutFull, stage: HTMLElement): AgentPageApi {
  let campaign = first;
  let api = createApi(campaign, stage);
  let refreshing: Promise<void> | null = null;

  const refresh = async () => {
    let next = await loadCampaign(campaign.id);
    while (next.registration_status === 'registering') {
      await new Promise((resolve) => setTimeout(resolve, RUN_POLL_MS));
      next = await loadCampaign(campaign.id);
    }
    campaign = next;
    api = createApi(campaign, stage);
  };

  const current = async () => {
    if (imageryDue(campaign)) {
      refreshing ??= refresh()
        .catch(() => {})
        .finally(() => {
          refreshing = null;
        });
    }
    await refreshing;
    return api;
  };

  return {
    context: () => api.context(),
    defaultViews: () => api.defaultViews(),
    render: async (...args) => (await current()).render(...args),
    locate: (...args) => api.locate(...args),
    preload: (...args) => void current().then((a) => a.preload(...args)),
    probe: async (...args) => (await current()).probe(...args),
  };
}

function createSetupApi(collections: StacCollectionInfo[]): AgentSetupApi {
  return {
    options: setupOptions,
    imagery: async (campaignId, recipes, basemaps, remove) => {
      if (campaignId === null) {
        return mergedImagery({ sources: [], basemaps: [] }, recipes, collections, {
          basemaps: basemaps ?? DEFAULT_BASEMAPS.map((b) => b.name),
        });
      }
      const { data } = await getCampaignWithImageryWindows({
        path: { campaign_id: campaignId },
        throwOnError: true,
      });
      return mergedImagery(
        { sources: data.imagery_sources, basemaps: data.basemaps },
        recipes,
        collections,
        { basemaps, remove }
      );
    },
  };
}

/**
 * A page with no interface that the MCP server keeps open in a headless browser, one per
 * agent. The server calls `window.stacnotatorAgent` to draw views and reads the images
 * straight back, so nothing rendered goes through the backend.
 *
 * Opened at `/agent-render?campaign=<id>`. Opened at `/agent-render?project=<id>` it
 * instead exposes `window.stacnotatorSetup`, which builds a new campaign's imagery or
 * merges recipes into an existing campaign's imagery.
 */
export default function AgentRenderPage() {
  const params = new URLSearchParams(window.location.search);
  const campaignId = Number(params.get('campaign'));
  const projectId = Number(params.get('project'));
  const stageRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const fail = (message: string) => {
      window.stacnotatorAgentError = message;
      setStatus(`error: ${message}`);
    };
    const valid = (id: number) => Number.isInteger(id) && id > 0;
    if (!valid(campaignId) && !valid(projectId)) {
      fail('The page needs ?campaign=<id> or ?project=<id>');
      return;
    }
    authManager.registerProvider(injectedTokenAdapter);
    authManager.setActiveProvider(INJECTED_PROVIDER);
    if (!valid(campaignId)) {
      getCollections({
        query: { catalog_url: MPC_API_URL, project_id: projectId },
        throwOnError: true,
      })
        .then(({ data }) => {
          window.stacnotatorSetup = createSetupApi(data);
          setStatus('ready');
        })
        .catch((err) => fail(extractErrorMessage(err, 'Could not load the imagery catalog')));
      return;
    }
    loadCampaign(campaignId)
      .then((campaign) => {
        window.stacnotatorAgent = renewingApi(campaign, stageRef.current!);
        setStatus('ready');
      })
      .catch((err) => fail(extractErrorMessage(err, 'Could not load the campaign')));
  }, [campaignId, projectId]);

  return (
    <main style={{ font: '12px sans-serif', padding: 8 }}>
      <p>Agent render page - {status}</p>
      <div ref={stageRef} aria-hidden style={{ position: 'fixed', left: -10000, top: 0 }} />
    </main>
  );
}
