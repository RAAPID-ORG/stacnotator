import { useCallback, useEffect, useState } from 'react';
import { deleteVisualizer, listVisualizers, type VisualizerListItemOut } from '~/api/client';
import { Button } from '~/shared/ui/forms';
import { Delayed } from '~/shared/ui/Delayed';
import {
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconGlobe,
  IconMap,
  IconPencil,
  IconTrash,
} from '~/shared/ui/Icons';
import { SkeletonRows } from '~/shared/ui/Skeleton';
import { listRowCls } from '~/shared/ui/listRow';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import { visualizerPath, visualizerUrl } from './route';
import { VisualizerEditor } from './VisualizerEditor';

/**
 * The project's visualizers: published maps over imagery and overlays its
 * campaigns already registered. Setting one up is picking from that list, so
 * this is a picker and a share link, not another imagery wizard.
 */
export function ProjectVisualizersSection({
  projectId,
  canManage,
}: {
  projectId: number;
  canManage: boolean;
}) {
  const [items, setItems] = useState<VisualizerListItemOut[] | null>(null);
  const [editing, setEditing] = useState<{ id: number | null } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const showAlert = useLayoutStore((s) => s.showAlert);

  const load = useCallback(async () => {
    try {
      const { data } = await listVisualizers({ path: { project_id: projectId } });
      setItems(data ?? []);
    } catch (error) {
      handleError(error, 'Failed to load visualizers');
      setItems([]);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyLink = (item: VisualizerListItemOut) => {
    void navigator.clipboard?.writeText(visualizerUrl(item.slug));
    setCopied(item.id);
    setTimeout(() => setCopied(null), 1600);
  };

  const remove = async (item: VisualizerListItemOut) => {
    const confirmed = await showConfirmDialog({
      title: `Delete "${item.name}"?`,
      description: 'Anyone holding its link will stop being able to open it.',
      confirmText: 'Delete',
      isDangerous: true,
    });
    if (!confirmed) return;
    try {
      await deleteVisualizer({ path: { visualizer_id: item.id } });
      showAlert('Visualizer deleted', 'success');
      void load();
    } catch (error) {
      handleError(error, 'Failed to delete the visualizer');
    }
  };

  return (
    <div id="tab-visualizers" role="tabpanel">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="section-heading">Visualizers</h2>
          <p className="section-description">
            Publish maps that let people explore imagery and predicted layers together. A published
            map can stay internal to the project, or be fully public to anyone with the link.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setEditing({ id: null })}>
            New visualizer
          </Button>
        )}
      </div>

      {items === null ? (
        <Delayed>
          <SkeletonRows count={3} />
        </Delayed>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-200 px-6 py-10 text-center">
          <IconMap className="mx-auto h-6 w-6 text-neutral-300" />
          <p className="mt-2 text-sm text-neutral-600">No visualizers yet.</p>
          <p className="mt-1 text-xs text-neutral-500">
            {canManage
              ? 'Build one from imagery a campaign in this project has already registered.'
              : 'A project admin can publish one from this project’s imagery.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          {items.map((item, index) => (
            <div
              key={item.id}
              className={listRowCls(index, { extra: 'flex items-center gap-3 px-4 py-2.5' })}
              data-testid="visualizer-row"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <a
                    href={visualizerPath(item.slug)}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-sm font-medium text-neutral-900 hover:text-brand-700 hover:underline"
                  >
                    {item.name}
                  </a>
                  {item.is_public ? (
                    <span
                      title="Anyone with the link can open this"
                      className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
                    >
                      <IconGlobe className="h-3 w-3" />
                      Public
                    </span>
                  ) : (
                    <span
                      title="Only people with access to this project can open it"
                      className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600"
                    >
                      Project only
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-neutral-500">
                  {item.description ||
                    `${item.imagery_count} imagery ${plural(item.imagery_count, 'source')}, ${item.overlay_count} ${plural(item.overlay_count, 'overlay')}`}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <RowButton label="Copy link" onClick={() => copyLink(item)}>
                  {copied === item.id ? (
                    <IconCheck className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <IconCopy className="h-4 w-4" />
                  )}
                </RowButton>
                <a
                  href={visualizerPath(item.slug)}
                  target="_blank"
                  rel="noreferrer"
                  title="Open"
                  className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <IconExternalLink className="h-4 w-4" />
                </a>
                {canManage && (
                  <>
                    <RowButton label="Edit" onClick={() => setEditing({ id: item.id })}>
                      <IconPencil className="h-4 w-4" />
                    </RowButton>
                    <RowButton label="Delete" danger onClick={() => void remove(item)}>
                      <IconTrash className="h-4 w-4" />
                    </RowButton>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <VisualizerEditor
          projectId={projectId}
          visualizerId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

const plural = (count: number, word: string) => (count === 1 ? word : `${word}s`);

const RowButton = ({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className={`cursor-pointer rounded p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 ${
      danger ? 'hover:text-red-600' : 'hover:text-neutral-700'
    }`}
  >
    {children}
  </button>
);
