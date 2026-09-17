import { useEffect, useState } from 'react';
import { getCampaignWithImageryWindows, type CampaignOutFull } from '~/api/client';
import { authManager } from '~/features/auth';
import type { AuthAdapter } from '~/features/auth/core/authAdapter';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { useRenderLoop } from './agents/useRenderLoop';

declare global {
  interface Window {
    /** Set and refreshed by the MCP server that started this headless page. */
    __stacnotatorToken?: string;
  }
}

const INJECTED_PROVIDER = 'injected';

/** The page has no sign-in of its own: the SDK login of whoever runs the agents is
 *  handed in by the process that opened it. */
const injectedTokenAdapter: AuthAdapter = {
  id: INJECTED_PROVIDER,
  login: async () => {
    throw new Error('A render page is signed in by the process that opens it');
  },
  logout: async () => {},
  isAuthenticated: () => !!window.__stacnotatorToken,
  getIdToken: async () => {
    if (!window.__stacnotatorToken) throw new Error('No token handed to the render page');
    return window.__stacnotatorToken;
  },
  onAuthStateChanged: () => () => {},
};

/**
 * A page with no interface that a headless browser keeps open to draw one agent's views,
 * and other agents' of the same owner when that one has nothing queued. Its state is on
 * `body[data-render-status]` for the process that watches it.
 *
 * Opened at `/agent-render?campaign=<id>&agent=<agent id>`.
 */
export default function AgentRenderPage() {
  const params = new URLSearchParams(window.location.search);
  const campaignId = Number(params.get('campaign'));
  const agentId = params.get('agent') ?? undefined;
  const [campaign, setCampaign] = useState<CampaignOutFull>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const { stageRef, rendered, lastError } = useRenderLoop({
    campaign,
    enabled: !!campaign,
    preferAgentId: agentId,
  });

  useEffect(() => {
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      setLoadError('The page needs ?campaign=<id>');
      return;
    }
    authManager.registerProvider(injectedTokenAdapter);
    authManager.setActiveProvider(INJECTED_PROVIDER);
    getCampaignWithImageryWindows({ path: { campaign_id: campaignId } })
      .then(({ data }) => setCampaign(data))
      .catch((err) => setLoadError(extractErrorMessage(err, 'Could not load the campaign')));
  }, [campaignId]);

  const status = loadError ? `error: ${loadError}` : campaign ? 'ready' : 'loading';
  useEffect(() => {
    document.body.dataset.renderStatus = status;
  }, [status]);

  return (
    <main style={{ font: '12px sans-serif', padding: 8 }}>
      <p>
        Agent render page - {status} - {rendered} views drawn
        {lastError ? ` - last error: ${lastError}` : ''}
      </p>
      <div ref={stageRef} aria-hidden style={{ position: 'fixed', left: -10000, top: 0 }} />
    </main>
  );
}
