import { create } from 'zustand';
import { replayAnnotationAction } from '~/api/client';
import { client } from '~/api/client/client.gen';
import i18n from '~/shared/i18n';
import { handleError } from '~/shared/utils/errorHandler';
import { wktToGeometry } from '../campaign/annotation';
import { useCampaignStore } from './campaign';
import { useTasksStore } from './tasks';
import { useWorkStore } from './work';

const t = i18n.getFixedT(null, 'annotation');
const MAX_ACTIONS = 100;
let session = 0;

interface HistoryState {
  undoStack: string[];
  redoStack: string[];
  pending: number;
  busy: boolean;
}

const emptyHistory: HistoryState = { undoStack: [], redoStack: [], pending: 0, busy: false };
export const useHistoryStore = create<HistoryState>(() => emptyHistory);

export function historyAvailable(undo: boolean): boolean {
  const history = useHistoryStore.getState();
  const work = useWorkStore.getState();
  return (
    useCampaignStore.getState().workMode === 'explore' &&
    !history.busy &&
    history.pending === 0 &&
    !useTasksStore.getState().isSubmitting &&
    !work.edit?.busy &&
    !work.edit?.pending &&
    work.draft.phase !== 'committing' &&
    !(work.draft.phase === 'draft' && work.draft.savedId === null) &&
    (undo ? history.undoStack : history.redoStack).length > 0
  );
}

export function trackLabellingHistory(campaignId: number): () => void {
  session++;
  const previousFetch = client.getConfig().fetch;
  const fetchRequest = previousFetch ?? globalThis.fetch;
  const mutation = new RegExp(
    `/campaigns/${campaignId}/annotations(?:/(?:\\d+|batch-create|batch-delete))?$`
  );
  let active = true;
  useHistoryStore.setState(emptyHistory);

  const trackedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (
      useCampaignStore.getState().workMode !== 'explore' ||
      !mutation.test(new URL(request.url).pathname) ||
      !['POST', 'PUT', 'DELETE'].includes(request.method)
    ) {
      return fetchRequest(request);
    }
    if (useHistoryStore.getState().busy) throw new Error(t('history.busy'));
    request.headers.set('X-Annotation-History', 'true');
    useHistoryStore.setState((s) => ({ pending: s.pending + 1 }));
    try {
      const response = await fetchRequest(request);
      const actionId = response.headers.get('X-Annotation-Action');
      if (active && response.ok && actionId) {
        useHistoryStore.setState((s) => ({
          undoStack: [...s.undoStack, actionId].slice(-MAX_ACTIONS),
          redoStack: [],
        }));
      }
      return response;
    } finally {
      if (active) useHistoryStore.setState((s) => ({ pending: s.pending - 1 }));
    }
  };
  client.setConfig({ fetch: trackedFetch });
  return () => {
    active = false;
    session++;
    client.setConfig({ fetch: previousFetch });
    useHistoryStore.setState(emptyHistory);
  };
}

export async function replayLabelling(undo: boolean): Promise<void> {
  if (!historyAvailable(undo)) return;
  const { campaign } = useCampaignStore.getState();
  if (!campaign) return;
  const stack = undo ? useHistoryStore.getState().undoStack : useHistoryStore.getState().redoStack;
  const actionId = stack[stack.length - 1];
  const replaySession = session;
  useHistoryStore.setState({ busy: true });
  try {
    const { data } = await replayAnnotationAction({
      path: { campaign_id: campaign.id, action_id: actionId },
      body: { undo },
      throwOnError: true,
    });
    if (session !== replaySession) return;
    useHistoryStore.setState((s) =>
      undo
        ? { undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, actionId] }
        : { redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, actionId] }
    );
    const work = useWorkStore.getState();
    if (useCampaignStore.getState().workMode === 'explore') {
      work.clearEdit();
      useWorkStore.setState({ draft: { phase: 'idle' } });
    }
    work.recordDeletes(data.deleted_ids);
    work.recordWrites(
      data.annotations.map((annotation) => ({
        id: annotation.id,
        labelId: annotation.label_id,
        geometry: wktToGeometry(annotation.geometry_wkt),
        origin: 'local',
      })),
      true
    );
  } catch (error) {
    if (session === replaySession) {
      handleError(error, t(undo ? 'history.undoFailed' : 'history.redoFailed'));
    }
  } finally {
    if (session === replaySession) {
      useHistoryStore.setState({ busy: false });
    }
  }
}
