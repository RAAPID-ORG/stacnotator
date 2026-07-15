import { useRef, useCallback } from 'react';
import type { FormFieldOption } from '~/api/client';
import { MAX_FIELDS, MAX_OPTIONS, type FormField } from '~/features/campaigns/utils/formFields';
import { Input, Select, Switch } from '~/shared/ui/forms';

const FIELD_TYPE_OPTIONS = [
  { value: 'category', label: 'Category' },
  { value: 'multicategory', label: 'Multi category' },
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date' },
  { value: 'daterange', label: 'Date range' },
] as const;

type FieldType = (typeof FIELD_TYPE_OPTIONS)[number]['value'];

function isFieldType(value: string): value is FieldType {
  return FIELD_TYPE_OPTIONS.some((o) => o.value === value);
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
          + Add field
        </button>
        {value.length >= MAX_FIELDS && (
          <p className="text-xs text-neutral-400 italic">Maximum of {MAX_FIELDS} fields reached.</p>
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
                placeholder="Question title"
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
                {FIELD_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <Input
            type="text"
            value={field.description ?? ''}
            placeholder="Description (optional)"
            onChange={(e) => onChange(withBase(field, { description: e.target.value || null }))}
            maxLength={2000}
          />

          <Switch
            checked={field.required ?? false}
            onChange={(checked) => onChange(withBase(field, { required: checked }))}
            label="Required"
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
          aria-label="Remove field"
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
              placeholder="Option name"
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
            aria-label="Remove option"
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
          + Add option
        </button>
        {field.options.length >= MAX_OPTIONS && (
          <p className="text-xs text-neutral-400 italic">
            Maximum of {MAX_OPTIONS} options reached.
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
          <option value="float">Float</option>
          <option value="int">Integer</option>
        </Select>
        <Input
          type="number"
          size="sm"
          placeholder="Min"
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
          placeholder="Max"
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
          placeholder="Step"
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
        label="Show as slider"
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
}) => (
  <Switch
    checked={field.multiline ?? false}
    onChange={(checked) => onChange({ ...field, multiline: checked })}
    label="Multiline"
  />
);
