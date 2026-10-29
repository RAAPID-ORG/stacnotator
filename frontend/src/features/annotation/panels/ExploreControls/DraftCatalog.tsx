import { useTranslation } from 'react-i18next';
import { IconClose } from '~/shared/ui/Icons';
import { capitalizeFirst } from '~/shared/utils/utility';
import type { FormField, FormValues } from '../../campaign/annotation';
import type { ExtendedLabel } from '../../campaign/annotation';
import { FormFields } from '../../components/FormFields';

export interface DraftCatalogProps {
  label: ExtendedLabel | null;
  fields: FormField[];
  values: FormValues;
  activeFieldIndex: number | null;
  onChange: (next: FormValues) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  /** The shape is already stored, so only the answers are outstanding. */
  saved: boolean;
  error?: string | null;
}

export function DraftCatalog({
  label,
  fields,
  values,
  activeFieldIndex,
  onChange,
  onSave,
  onClose,
  saving,
  saved,
  error = null,
}: DraftCatalogProps) {
  const { t } = useTranslation('panels');
  const geometry = label?.geometry_type ?? 'polygon';

  return (
    <div data-testid="draft-catalog" className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-neutral-700">
          {label && (
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ backgroundColor: label.color }}
            />
          )}
          <span className="truncate" title={label?.name}>
            {label ? capitalizeFirst(label.name) : t('draft.annotation')}
          </span>
        </span>
        <button
          type="button"
          data-testid="draft-close"
          onClick={onClose}
          title={saved ? t('draft.closeSaved') : t('draft.closeUnsaved')}
          aria-label={saved ? t('draft.closeSaved') : t('draft.closeUnsaved')}
          className="flex-shrink-0 p-1 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer transition-colors"
        >
          <IconClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      <div className="flex flex-wrap border-t border-l border-neutral-100 rounded">
        <FormFields
          fields={fields}
          values={values}
          onChange={onChange}
          activeFieldIndex={activeFieldIndex}
          disabled={saving}
        />
      </div>

      <button
        type="button"
        data-testid="draft-save"
        onClick={onSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors"
      >
        <span className="truncate">
          {error ? t('draft.retry') : saved ? t('draft.saveAnswers') : t('draft.save')}
        </span>
        <span className="text-[10px] font-normal text-white/70" aria-hidden>
          {t('draft.saveKey')}
        </span>
      </button>
      <p className="text-[11px] text-neutral-500">
        {saved ? t(`draft.savedHint.${geometry}`) : t(`draft.drawAnotherHint.${geometry}`)}
      </p>
    </div>
  );
}
