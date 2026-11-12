import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import type { CustomIndexIn } from '~/api/client';
import { previewCustomIndexMutation } from '~/api/queries';
import { extractErrorMessage } from '~/shared/utils/errorHandler';
import { Button, IconButton, Input } from '~/shared/ui/forms';
import { IconClose } from '~/shared/ui/Icons';
import { InfoPopover } from '~/shared/ui/InfoPopover';

const FUNCTIONS = ['sqrt', 'abs', 'log', 'exp', 'min', 'max'];
const PREVIEW_DELAY_MS = 300;

const Caption = ({ children }: { children: ReactNode }) => (
  <span className="block text-[11px] font-medium text-neutral-500 mb-1">{children}</span>
);

/**
 * Defines a series' custom index inline, under its index picker. The backend's
 * preview checks the formula as it is typed, so only one it accepts can be used.
 */
export const CustomIndexForm = ({
  bands,
  sourceKey,
  sourceLabel,
  initial,
  others,
  onUse,
  onCancel,
}: {
  /** The band roles the series' source offers. */
  bands: string[];
  sourceKey: string;
  sourceLabel: string;
  initial: CustomIndexIn | null;
  /** The custom indices other series use; a name means one definition. */
  others: CustomIndexIn[];
  onUse: (index: CustomIndexIn) => void;
  onCancel: () => void;
}) => {
  const { t } = useTranslation(['campaigns', 'common']);
  const [name, setName] = useState(initial?.name ?? '');
  const [expression, setExpression] = useState(initial?.expression ?? '');
  const [domainMin, setDomainMin] = useState(String(initial?.domain_min ?? -1));
  const [domainMax, setDomainMax] = useState(String(initial?.domain_max ?? 1));
  const formulaId = useId();
  // Shown inline as the admin types, so never toasted.
  const preview = useMutation({
    ...previewCustomIndexMutation(),
    meta: { errorMessage: t('customIndices.previewFailed'), showUser: false },
  });
  const { mutate, reset } = preview;

  const body = useMemo((): CustomIndexIn | null => {
    const min = Number(domainMin);
    const max = Number(domainMax);
    if (!domainMin.trim() || !domainMax.trim() || !Number.isFinite(min + max)) return null;
    return { name: name.trim(), expression, domain_min: min, domain_max: max };
  }, [name, expression, domainMin, domainMax]);

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
  const clash =
    !!body &&
    others.some(
      (other) =>
        other.name === body.name &&
        (other.expression.trim() !== body.expression.trim() ||
          other.domain_min !== body.domain_min ||
          other.domain_max !== body.domain_max)
    );
  const accepted = current && fitsSource && !clash ? current : null;
  const error = !body
    ? t('customIndices.badNumber')
    : clash
      ? t('customIndices.duplicate')
      : preview.isError
        ? extractErrorMessage(preview.error)
        : !fitsSource
          ? t('customIndices.notOnSource', { source: sourceLabel })
          : null;

  return (
    <div className="rounded-md border border-neutral-200 bg-white p-2.5 space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-24">
          <Caption>{t('customIndices.name')}</Caption>
          <Input
            size="sm"
            autoFocus
            placeholder="CIre"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
          />
        </div>
        <label className="w-16">
          <Caption>{t('customIndices.axisMin')}</Caption>
          <Input
            size="sm"
            inputMode="decimal"
            value={domainMin}
            onChange={(e) => setDomainMin(e.target.value)}
          />
        </label>
        <label className="w-16">
          <Caption>{t('customIndices.axisMax')}</Caption>
          <Input
            size="sm"
            inputMode="decimal"
            value={domainMax}
            onChange={(e) => setDomainMax(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-1 pb-1">
          <IconButton
            aria-label={t('common:actions.cancel')}
            title={t('common:actions.cancel')}
            onClick={onCancel}
          >
            <IconClose className="h-4 w-4" />
          </IconButton>
          <Button size="sm" disabled={!accepted} onClick={() => body && onUse(body)}>
            {initial ? t('common:actions.save') : t('customIndices.add')}
          </Button>
        </div>
      </div>
      <div aria-live="polite" className="min-h-[1rem] text-xs">
        {error ? (
          <span role="alert" className="text-red-600">
            {error}
          </span>
        ) : accepted ? (
          <span className="font-mono text-neutral-600 break-all" data-testid="custom-index-preview">
            {accepted.formula}
          </span>
        ) : (
          <span className="text-neutral-400">{t('customIndices.previewHint')}</span>
        )}
      </div>
    </div>
  );
};
