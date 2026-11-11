import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import type { CustomIndexIn, CustomIndexOut } from '~/api/client';
import { previewCustomIndexMutation } from '~/api/queries';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { Button, IconButton, Input } from '~/shared/ui/forms';
import { IconClose, IconTrash } from '~/shared/ui/Icons';
import { InfoPopover } from '~/shared/ui/InfoPopover';

const FUNCTIONS = ['sqrt', 'abs', 'log', 'exp', 'min', 'max', 'clamp', 'where'];
const PREVIEW_DELAY_MS = 300;

interface Draft {
  name: string;
  expression: string;
  domainMin: string;
  domainMax: string;
  referenceLines: string;
}

const draftOf = (index: CustomIndexOut | null): Draft =>
  index
    ? {
        name: index.key,
        expression: index.expression,
        domainMin: String(index.domain_min),
        domainMax: String(index.domain_max),
        referenceLines: index.reference_lines.join(', '),
      }
    : { name: '', expression: '', domainMin: '-1', domainMax: '1', referenceLines: '' };

/** The request a draft stands for, or null while a number field does not parse. */
const bodyOf = (draft: Draft): CustomIndexIn | null => {
  const domainMin = Number(draft.domainMin);
  const domainMax = Number(draft.domainMax);
  const lines = draft.referenceLines
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  if (!draft.domainMin.trim() || !draft.domainMax.trim()) return null;
  if ([domainMin, domainMax, ...lines].some((n) => !Number.isFinite(n))) return null;
  return {
    name: draft.name.trim(),
    expression: draft.expression,
    domain_min: domainMin,
    domain_max: domainMax,
    reference_lines: lines,
  };
};

const Caption = ({ children }: { children: ReactNode }) => (
  <span className="block text-[11px] font-medium text-neutral-500 mb-1">{children}</span>
);

/**
 * Defines or edits one custom index inline, under the index picker. The backend's
 * preview checks the formula as it is typed, so Save only ever sends one it accepts.
 */
export const CustomIndexForm = ({
  bands,
  sourceKey,
  sourceLabel,
  editing,
  takenNames,
  canDelete,
  onSave,
  onDelete,
  onCancel,
}: {
  /** The band roles the series' source offers. */
  bands: string[];
  /** The series' source; an index it cannot compute is not offered for saving. */
  sourceKey: string;
  sourceLabel: string;
  /** The index being edited, or null for a new one. */
  editing: CustomIndexOut | null;
  takenNames: string[];
  /** False while another series plots the index. */
  canDelete: boolean;
  onSave: (body: CustomIndexIn, described: CustomIndexOut) => Promise<void>;
  onDelete: () => void;
  onCancel: () => void;
}) => {
  const { t } = useTranslation(['campaigns', 'common']);
  const [draft, setDraft] = useState(() => draftOf(editing));
  const [saving, setSaving] = useState(false);
  const formulaId = useId();
  // Shown inline as the admin types, so never toasted.
  const preview = useMutation({
    ...previewCustomIndexMutation(),
    meta: { errorMessage: t('customIndices.previewFailed'), showUser: false },
  });
  const { mutate, reset } = preview;

  const body = useMemo(() => bodyOf(draft), [draft]);
  const duplicate = !!body && takenNames.includes(body.name);

  useEffect(() => {
    if (!body?.name || !body.expression.trim()) {
      reset();
      return;
    }
    const timer = setTimeout(() => mutate({ body }), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [body, mutate, reset]);

  // A preview counts only for the draft it was asked for, not one typed since.
  const current = preview.isSuccess && preview.variables?.body === body ? preview.data : null;
  const fitsSource = !current || current.source_keys.includes(sourceKey);
  const described = current && !duplicate && fitsSource ? current : null;
  const error = duplicate
    ? t('customIndices.duplicate')
    : !body
      ? t('customIndices.badNumber')
      : preview.isError
        ? extractErrorMessage(preview.error)
        : !fitsSource
          ? t('customIndices.notOnSource', { source: sourceLabel })
          : null;

  const save = async () => {
    if (!body || !described) return;
    setSaving(true);
    try {
      await onSave(body, described);
    } finally {
      setSaving(false);
    }
  };

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  return (
    <div className="rounded-md border border-neutral-200 bg-white p-2.5 space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-24">
          <Caption>{t('customIndices.name')}</Caption>
          <Input
            size="sm"
            autoFocus
            placeholder="CIre"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <div className="min-w-[10rem] flex-1">
          <div className="flex items-center gap-1 mb-1">
            <label htmlFor={formulaId} className="text-[11px] font-medium text-neutral-500">
              {t('customIndices.expression')}
            </label>
            <InfoPopover>
              <p className="text-xs">
                {t('customIndices.help', {
                  bands: bands.join(', '),
                  functions: FUNCTIONS.join(', '),
                })}
              </p>
            </InfoPopover>
          </div>
          <Input
            id={formulaId}
            size="sm"
            className="font-mono"
            placeholder="nir / rededge1 - 1"
            value={draft.expression}
            onChange={(e) => set({ expression: e.target.value })}
          />
        </div>
        <label className="w-16">
          <Caption>{t('customIndices.axisMin')}</Caption>
          <Input
            size="sm"
            inputMode="decimal"
            value={draft.domainMin}
            onChange={(e) => set({ domainMin: e.target.value })}
          />
        </label>
        <label className="w-16">
          <Caption>{t('customIndices.axisMax')}</Caption>
          <Input
            size="sm"
            inputMode="decimal"
            value={draft.domainMax}
            onChange={(e) => set({ domainMax: e.target.value })}
          />
        </label>
        <label className="w-24">
          <Caption>{t('customIndices.referenceLines')}</Caption>
          <Input
            size="sm"
            placeholder="0, 0.5"
            value={draft.referenceLines}
            onChange={(e) => set({ referenceLines: e.target.value })}
          />
        </label>
        <div className="flex items-center gap-1 pb-1">
          {editing && (
            <IconButton
              tone="danger"
              disabled={!canDelete || saving}
              aria-label={t('customIndices.delete', { name: editing.label })}
              title={
                canDelete
                  ? t('customIndices.delete', { name: editing.label })
                  : t('customIndices.inUse')
              }
              onClick={onDelete}
            >
              <IconTrash className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton
            aria-label={t('common:actions.cancel')}
            title={t('common:actions.cancel')}
            disabled={saving}
            onClick={onCancel}
          >
            <IconClose className="h-4 w-4" />
          </IconButton>
          <Button size="sm" disabled={!described || saving} onClick={() => void save()}>
            {editing ? t('common:actions.save') : t('customIndices.add')}
          </Button>
        </div>
      </div>
      <div aria-live="polite" className="min-h-[1rem] text-xs">
        {error ? (
          <span role="alert" className="text-red-600">
            {error}
          </span>
        ) : described ? (
          <span className="font-mono text-neutral-600 break-all" data-testid="custom-index-preview">
            {described.formula}
          </span>
        ) : (
          <span className="text-neutral-400">{t('customIndices.previewHint')}</span>
        )}
      </div>
    </div>
  );
};
