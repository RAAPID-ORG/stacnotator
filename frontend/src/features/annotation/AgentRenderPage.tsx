import { useEffect, useRef, useState } from 'react';
import { getCampaignWithImageryWindows, type CampaignOutFull } from '~/api/client';
import { authManager } from '~/features/auth';
import type { AuthAdapter } from '~/features/auth/core/authAdapter';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { buildImageryCatalog } from './campaign/imagery';
import { renderView, type RenderedImage } from './agents/render';
import {
  campaignContext,
  checkView,
  defaultViews,
  type AgentTask,
  type CampaignContext,
  type ViewSpec,
} from './agents/view';

type RenderedView = { view: ViewSpec } & (RenderedImage | { error: string });

interface AgentPageApi {
  context(): CampaignContext;
  defaultViews(): ViewSpec[];
  render(task: AgentTask, views: ViewSpec[]): Promise<RenderedView[]>;
  /** Draws in the background, one view at a time, so a later render is instant. */
  preload(tasks: AgentTask[], views: ViewSpec[]): void;
}

declare global {
  interface Window {
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

  const draw = (task: AgentTask, view: ViewSpec): Promise<RenderedView> => {
    const key = `${task.task_id}|${JSON.stringify(view)}`;
    const cached = drawn.get(key);
    if (cached) return cached;
    const pending = Promise.resolve()
      .then(() => {
        checkView(view);
        return renderView({ task, view, campaign, catalog, stage });
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
    render: (task, views) => Promise.all(views.map((view) => draw(task, view))),
    preload: (tasks, views) => {
      void (async () => {
        for (const task of tasks) for (const view of views) await draw(task, view);
      })();
    },
  };
}

/**
 * A page with no interface that the MCP server keeps open in a headless browser, one per
 * agent. The server calls `window.stacnotatorAgent` to draw views and reads the images
 * straight back, so nothing rendered goes through the backend.
 *
 * Opened at `/agent-render?campaign=<id>`.
 */
export default function AgentRenderPage() {
  const campaignId = Number(new URLSearchParams(window.location.search).get('campaign'));
  const stageRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const fail = (message: string) => {
      window.stacnotatorAgentError = message;
      setStatus(`error: ${message}`);
    };
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      fail('The page needs ?campaign=<id>');
      return;
    }
    authManager.registerProvider(injectedTokenAdapter);
    authManager.setActiveProvider(INJECTED_PROVIDER);
    getCampaignWithImageryWindows({ path: { campaign_id: campaignId }, throwOnError: true })
      .then(({ data }) => {
        window.stacnotatorAgent = createApi(data, stageRef.current!);
        setStatus('ready');
      })
      .catch((err) => fail(extractErrorMessage(err, 'Could not load the campaign')));
  }, [campaignId]);

  return (
    <main style={{ font: '12px sans-serif', padding: 8 }}>
      <p>Agent render page - {status}</p>
      <div ref={stageRef} aria-hidden style={{ position: 'fixed', left: -10000, top: 0 }} />
    </main>
  );
}
