import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type VisualizerListItemOut } from '~/api/client';
import {
  deleteVisualizerMutation,
  listVisualizersOptions,
  listVisualizersQueryKey,
} from '~/api/queries';
import { Button } from '~/shared/ui/forms';
import {
  IconCheck,
  IconComment,
  IconCopy,
  IconExternalLink,
  IconGlobe,
  IconMap,
  IconPencil,
  IconPlus,
  IconTrash,
} from '~/shared/ui/Icons';
import { SkeletonRows } from '~/shared/ui/Skeleton';
import { listRowCls } from '~/shared/ui/listRow';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { visualizerFeedbackPath, visualizerPath, visualizerUrl } from './route';
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
  const { t } = useTranslation('visualizers');
  const [editing, setEditing] = useState<{ id: number | null } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const showConfirmDialog = useLayoutStore((s) => s.showConfirmDialog);
  const showAlert = useLayoutStore((s) => s.showAlert);
  const queryClient = useQueryClient();
  const path = { project_id: projectId };

  // Null until the first answer arrives, which is what tells the skeleton from
  // a project with no visualizers yet.
  const { data } = useQuery({
    ...listVisualizersOptions({ path }),
    meta: { errorMessage: t('section.loadFailed') },
  });
  const items = data ?? null;

  const reloadVisualizers = () =>
    queryClient.invalidateQueries({ queryKey: listVisualizersQueryKey({ path }) });

  const removeVisualizer = useMutation({
    ...deleteVisualizerMutation(),
    meta: { errorMessage: t('section.deleteFailed') },
    onSuccess: () => {
      showAlert(t('section.deleted'), 'success');
      void reloadVisualizers();
    },
  });

  const copyLink = (item: VisualizerListItemOut) => {
    void navigator.clipboard?.writeText(visualizerUrl(item.slug));
    setCopied(item.id);
    setTimeout(() => setCopied(null), 1600);
  };

  const remove = async (item: VisualizerListItemOut) => {
    const confirmed = await showConfirmDialog({
      title: t('section.deleteTitle', { name: item.name }),
      description: t('section.deleteDescription'),
      confirmText: t('section.delete'),
      isDangerous: true,
    });
    if (!confirmed) return;
    removeVisualizer.mutate({ path: { visualizer_id: item.id } });
  };

  return (
    <div id="tab-visualizers" role="tabpanel">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="section-heading">{t('section.title')}</h2>
          <p className="section-description">{t('section.description')}</p>
        </div>
        {canManage && (
          <Button
            size="sm"
            onClick={() => setEditing({ id: null })}
            leading={<IconPlus className="h-4 w-4" />}
          >
            {t('section.new')}
          </Button>
        )}
      </div>

      {items === null ? (
        <SkeletonRows count={3} />
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-200 px-6 py-10 text-center">
          <IconMap className="mx-auto h-6 w-6 text-neutral-300" />
          <p className="mt-2 text-sm text-neutral-600">{t('section.empty')}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {canManage ? t('section.emptyManage') : t('section.emptyView')}
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
                      title={t('section.publicTitle')}
                      className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
                    >
                      <IconGlobe className="h-3 w-3" />
                      {t('section.public')}
                    </span>
                  ) : (
                    <span
                      title={t('section.projectOnlyTitle')}
                      className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600"
                    >
                      {t('section.projectOnly')}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-neutral-500">
                  {item.description ||
                    t('section.counts', {
                      imagery: t('section.imageryCount', { count: item.imagery_count }),
                      overlays: t('section.overlayCount', { count: item.overlay_count }),
                    })}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {canManage && item.feedback_count > 0 && (
                  <a
                    href={visualizerFeedbackPath(item.slug)}
                    target="_blank"
                    rel="noreferrer"
                    title={t('section.readFeedback', { count: item.feedback_count })}
                    data-testid="visualizer-feedback-count"
                    className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
                  >
                    <IconComment className="h-3.5 w-3.5" />
                    <span className="tabular-nums">{item.feedback_count}</span>
                  </a>
                )}
                <RowButton label={t('section.copyLink')} onClick={() => copyLink(item)}>
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
                  title={t('section.open')}
                  className="rounded p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <IconExternalLink className="h-4 w-4" />
                </a>
                {canManage && (
                  <>
                    <RowButton
                      label={t('section.edit')}
                      onClick={() => setEditing({ id: item.id })}
                    >
                      <IconPencil className="h-4 w-4" />
                    </RowButton>
                    <RowButton label={t('section.delete')} danger onClick={() => void remove(item)}>
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
            void reloadVisualizers();
          }}
          // Overlays are created against a visualizer that has to exist first, so a
          // brand new one stays open on its own id rather than closing - otherwise
          // setting one up means saving, finding it in the list, and reopening it.
          onCreated={(id) => {
            setEditing({ id });
            void reloadVisualizers();
          }}
        />
      )}
    </div>
  );
}

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
