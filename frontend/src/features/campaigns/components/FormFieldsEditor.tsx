import { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { FormFieldOption } from '~/api/client';
import { MAX_FIELDS, MAX_OPTIONS, type FormField } from '~/features/campaigns/utils/formFields';
import { Input, Select, Switch } from '~/shared/ui/forms';

const FIELD_TYPES = ['category', 'multicategory', 'number', 'text', 'date', 'daterange'] as const;

type FieldType = (typeof FIELD_TYPES)[number];

function isFieldType(value: string): value is FieldType {
  return FIELD_TYPES.some((type) => type === value);
}

type FieldBase = Pick<FormField, 'id' | 'title' | 'description' | 'required'>;

function makeField(type: FieldType, base: FieldBase): FormField {
  switch (type) {
    case 'category':
    case 'multicategory':
      return { ...base, type, options: [{ id: 1, name: '' }] };
    case 'number':
      return {
        ...base,
        type,
        number_type: 'float',
        min: null,
        max: null,
        step: null,
        slider: false,
      };
    case 'text':
      return { ...base, type, multiline: false };
    case 'date':
    case 'daterange':
      return { ...base, type };
  }
}

function withBase(field: FormField, patch: Partial<FieldBase>): FormField {
  return { ...field, ...patch };
}

interface FormFieldsEditorProps {
  value: FormField[];
  onChange: (fields: FormField[]) => void;
}

export const FormFieldsEditor = ({ value, onChange }: FormFieldsEditorProps) => {
  const { t } = useTranslation('campaigns');
  const titleRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const addField = useCallback(() => {
    const nextId = value.length === 0 ? 1 : Math.max(...value.map((f) => f.id)) + 1;
    const field = makeField('category', { id: nextId, title: '', required: false });
    onChange([...value, field]);

    requestAnimationFrame(() => {
      titleRefs.current.get(nextId)?.focus();
    });
  }, [value, onChange]);

  const replaceField = (next: FormField) => {
    onChange(value.map((f) => (f.id === next.id ? next : f)));
  };

  const removeField = (id: number) => {
    onChange(value.filter((f) => f.id !== id));
  };

  return (
    <div className="space-y-3">
      {value.map((field) => (
        <FieldRow
          key={field.id}
          field={field}
          onChange={replaceField}
          onRemove={() => removeField(field.id)}
          titleInputRef={(el) => {
            if (el) titleRefs.current.set(field.id, el);
            else titleRefs.current.delete(field.id);
          }}
        />
      ))}

      <div className="space-y-1">
        <button
          onClick={addField}
          disabled={value.length >= MAX_FIELDS}
          className="text-sm text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer disabled:text-neutral-400 disabled:no-underline disabled:cursor-not-allowed"
          type="button"
        >
          {t('formFields.addField')}
        </button>
        {value.length >= MAX_FIELDS && (
          <p className="text-xs text-neutral-400 italic">
            {t('formFields.maxFields', { max: MAX_FIELDS })}
          </p>
        )}
      </div>
    </div>
  );
};

const FieldRow = ({
  field,
  onChange,
  onRemove,
  titleInputRef,
}: {
  field: FormField;
  onChange: (next: FormField) => void;
  onRemove: () => void;
  titleInputRef: (el: HTMLInputElement | null) => void;
}) => {
  const { t } = useTranslation('campaigns');
  const changeType = (type: FieldType) => {
    if (field.type === type) return;
    onChange(
      makeField(type, {
        id: field.id,
        title: field.title,
        description: field.description,
        required: field.required ?? false,
      })
    );
  };

  return (
    <div className="border border-neutral-200 rounded-md p-3">
      <div className="flex gap-2 items-start">
        <span className="text-xs text-neutral-500 w-6 pt-2">{field.id}</span>

        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                type="text"
                value={field.title}
                placeholder={t('formFields.questionTitle')}
                ref={titleInputRef}
                onChange={(e) => onChange(withBase(field, { title: e.target.value }))}
                maxLength={200}
              />
            </div>
            <div className="w-40">
              <Select
                value={field.type}
                onChange={(e) => {
                  const next = e.target.value;
                  if (isFieldType(next)) changeType(next);
                }}
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`formFields.types.${type}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <Input
            type="text"
            value={field.description ?? ''}
            placeholder={t('formFields.descriptionPlaceholder')}
            onChange={(e) => onChange(withBase(field, { description: e.target.value || null }))}
            maxLength={2000}
          />

          <Switch
            checked={field.required ?? false}
            onChange={(checked) => onChange(withBase(field, { required: checked }))}
            label={t('formFields.required')}
          />

          {(field.type === 'category' || field.type === 'multicategory') && (
            <CategoryOptionsConfig field={field} onChange={onChange} />
          )}
          {field.type === 'number' && <NumberConfig field={field} onChange={onChange} />}
          {field.type === 'text' && <TextConfig field={field} onChange={onChange} />}
        </div>

        <button
          onClick={onRemove}
          className="text-sm text-neutral-400 hover:text-red-600 transition-colors px-1"
          type="button"
          aria-label={t('formFields.removeField')}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

const CategoryOptionsConfig = ({
  field,
  onChange,
}: {
  field: Extract<FormField, { type: 'category' | 'multicategory' }>;
  onChange: (next: FormField) => void;
}) => {
  const { t } = useTranslation('campaigns');
  const setOptions = (options: FormFieldOption[]) => onChange({ ...field, options });

  const addOption = () => {
    const nextId = field.options.length === 0 ? 1 : Math.max(...field.options.map((o) => o.id)) + 1;
    setOptions([...field.options, { id: nextId, name: '' }]);
  };

  return (
    <div className="pl-4 space-y-1.5 border-l-2 border-neutral-100">
      {field.options.map((option) => (
        <div key={option.id} className="flex gap-2 items-center">
          <span className="text-xs text-neutral-400 w-6">{option.id}</span>
          <div className="flex-1">
            <Input
              type="text"
              size="sm"
              value={option.name}
              placeholder={t('formFields.optionName')}
              onChange={(e) =>
                setOptions(
                  field.options.map((o) =>
                    o.id === option.id ? { ...o, name: e.target.value } : o
                  )
                )
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addOption();
                }
              }}
              maxLength={200}
            />
          </div>
          <button
            onClick={() => setOptions(field.options.filter((o) => o.id !== option.id))}
            className="text-sm text-neutral-400 hover:text-red-600 transition-colors px-1"
            type="button"
            aria-label={t('formFields.removeOption')}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="space-y-1">
        <button
          onClick={addOption}
          disabled={field.options.length >= MAX_OPTIONS}
          className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer disabled:text-neutral-400 disabled:no-underline disabled:cursor-not-allowed"
          type="button"
        >
          {t('formFields.addOption')}
        </button>
        {field.options.length >= MAX_OPTIONS && (
          <p className="text-xs text-neutral-400 italic">
            {t('formFields.maxOptions', { max: MAX_OPTIONS })}
          </p>
        )}
      </div>
    </div>
  );
};

const NumberConfig = ({
  field,
  onChange,
}: {
  field: Extract<FormField, { type: 'number' }>;
  onChange: (next: FormField) => void;
}) => {
  const { t } = useTranslation('campaigns');
  const boundsSet = field.min != null && field.max != null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        <Select
          value={field.number_type ?? 'float'}
          onChange={(e) => {
            const next = e.target.value;
            if (next === 'int' || next === 'float') {
              onChange({ ...field, number_type: next });
            }
          }}
          size="sm"
        >
          <option value="float">{t('formFields.float')}</option>
          <option value="int">{t('formFields.integer')}</option>
        </Select>
        <Input
          type="number"
          size="sm"
          placeholder={t('formFields.min')}
          value={field.min ?? ''}
          onChange={(e) => {
            const min = e.target.value === '' ? null : Number(e.target.value);
            const slider = (field.slider ?? false) && min != null && field.max != null;
            onChange({ ...field, min, slider });
          }}
        />
        <Input
          type="number"
          size="sm"
          placeholder={t('formFields.max')}
          value={field.max ?? ''}
          onChange={(e) => {
            const max = e.target.value === '' ? null : Number(e.target.value);
            const slider = (field.slider ?? false) && field.min != null && max != null;
            onChange({ ...field, max, slider });
          }}
        />
        <Input
          type="number"
          size="sm"
          placeholder={t('formFields.step')}
          value={field.step ?? ''}
          onChange={(e) => {
            const step = e.target.value === '' ? null : Number(e.target.value);
            onChange({ ...field, step });
          }}
        />
      </div>
      <Switch
        checked={field.slider ?? false}
        onChange={(checked) => onChange({ ...field, slider: checked })}
        disabled={!boundsSet}
        label={t('formFields.slider')}
      />
    </div>
  );
};

const TextConfig = ({
  field,
  onChange,
}: {
  field: Extract<FormField, { type: 'text' }>;
  onChange: (next: FormField) => void;
}) => {
  const { t } = useTranslation('campaigns');
  return (
    <Switch
      checked={field.multiline ?? false}
      onChange={(checked) => onChange({ ...field, multiline: checked })}
      label={t('formFields.multiline')}
    />
  );
};
