import { useEffect, useRef, useState } from 'react';
import {
  getCampaignWithImageryWindows,
  getCollections,
  type CampaignOutFull,
  type ImageryEditorStateCreate,
} from '~/api/client';
import { authManager } from '~/features/auth';
import type { AuthAdapter } from '~/features/auth/core/authAdapter';
import { MPC_API_URL } from '~/features/layers/imagery/mpcPresets';
import {
  imageryEditorState,
  mergedImagery,
  setupOptions,
  type ImageryRecipe,
  type StacCollectionInfo,
} from '~/features/layers/imagery/recipe';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { buildImageryCatalog } from './campaign/imagery';
import { renderView, type RenderedImage } from './agents/render';
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

interface AgentPageApi {
  context(): CampaignContext;
  defaultViews(): ViewSpec[];
  render(task: AgentTask, views: ViewSpec[], limits: ImageLimits): Promise<RenderedView[]>;
  /** Draws in the background, one view at a time, so a later render is instant. */
  preload(tasks: AgentTask[], views: ViewSpec[], limits: ImageLimits): void;
}

/** Expands imagery recipes into what the campaign wizard would have saved, for a new
 *  campaign or merged into an existing campaign's imagery. */
interface AgentSetupApi {
  options(): ReturnType<typeof setupOptions>;
  imagery(recipes: ImageryRecipe[], basemaps?: string[]): ImageryEditorStateCreate;
  editImagery(
    campaignId: number,
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
        (image): RenderedView => ({ view, ...image }),
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
    preload: (tasks, views, limits) => {
      void (async () => {
        for (const task of tasks) for (const view of views) await draw(task, view, limits);
      })();
    },
  };
}

function createSetupApi(collections: StacCollectionInfo[]): AgentSetupApi {
  return {
    options: setupOptions,
    imagery: (recipes, basemaps) => imageryEditorState(recipes, collections, basemaps),
    editImagery: async (campaignId, recipes, basemaps, remove) => {
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
    getCampaignWithImageryWindows({ path: { campaign_id: campaignId }, throwOnError: true })
      .then(({ data }) => {
        window.stacnotatorAgent = createApi(data, stageRef.current!);
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
