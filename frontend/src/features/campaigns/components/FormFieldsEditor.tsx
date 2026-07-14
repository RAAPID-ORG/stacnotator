import { useRef, useCallback } from 'react';
import type { FormFieldOption } from '~/api/client';
import type { FormField } from '~/features/campaigns/utils/formFields';
import { Input, Select, Switch } from '~/shared/ui/forms';

const FIELD_TYPES = ['select', 'multiselect', 'number', 'text', 'date', 'daterange'] as const;
type FieldType = (typeof FIELD_TYPES)[number];

function isFieldType(value: string): value is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(value);
}

const FIELD_TYPE_OPTIONS: Array<{ value: FieldType; label: string }> = [
  { value: 'select', label: 'Single select' },
  { value: 'multiselect', label: 'Multi select' },
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date' },
  { value: 'daterange', label: 'Date range' },
];

interface FieldBase {
  id: number;
  title: string;
  description?: string | null;
  required: boolean;
}

function makeField(type: FieldType, base: FieldBase): FormField {
  switch (type) {
    case 'select':
      return { ...base, type: 'select', options: [{ id: 1, name: '' }] };
    case 'multiselect':
      return { ...base, type: 'multiselect', options: [{ id: 1, name: '' }] };
    case 'number':
      return {
        ...base,
        type: 'number',
        number_type: 'float',
        min: null,
        max: null,
        step: null,
        slider: false,
      };
    case 'text':
      return { ...base, type: 'text', multiline: false };
    case 'date':
      return { ...base, type: 'date' };
    case 'daterange':
      return { ...base, type: 'daterange' };
  }
}

function withBase(field: FormField, patch: Partial<FieldBase>): FormField {
  switch (field.type) {
    case 'select':
    case 'multiselect':
      return { ...field, ...patch };
    case 'number':
      return { ...field, ...patch };
    case 'text':
      return { ...field, ...patch };
    case 'date':
    case 'daterange':
      return { ...field, ...patch };
  }
}

interface FormFieldsEditorProps {
  value: FormField[];
  onChange: (fields: FormField[]) => void;
  readOnly?: boolean;
  /** Hide field delete buttons (post-creation: removal would orphan stored answers). */
  disableDelete?: boolean;
}

export const FormFieldsEditor = ({
  value,
  onChange,
  readOnly = false,
  disableDelete = false,
}: FormFieldsEditorProps) => {
  const titleRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const addField = useCallback(() => {
    const nextId = value.length === 0 ? 1 : Math.max(...value.map((f) => f.id)) + 1;
    const field = makeField('select', { id: nextId, title: '', required: false });
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
      {readOnly && value.length === 0 && (
        <p className="text-xs text-neutral-500">No custom fields configured.</p>
      )}

      {value.map((field) => (
        <FieldRow
          key={field.id}
          field={field}
          readOnly={readOnly}
          canRemove={!readOnly && !disableDelete}
          onChange={replaceField}
          onRemove={() => removeField(field.id)}
          titleInputRef={(el) => {
            if (el) titleRefs.current.set(field.id, el);
            else titleRefs.current.delete(field.id);
          }}
        />
      ))}

      {!readOnly && (
        <button
          onClick={addField}
          className="text-sm text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          type="button"
        >
          + Add field
        </button>
      )}
    </div>
  );
};

const FieldRow = ({
  field,
  readOnly,
  canRemove,
  onChange,
  onRemove,
  titleInputRef,
}: {
  field: FormField;
  readOnly: boolean;
  canRemove: boolean;
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
                disabled={readOnly}
              />
            </div>
            <div className="w-40">
              <Select
                value={field.type}
                onChange={(e) => {
                  const next = e.target.value;
                  if (isFieldType(next)) changeType(next);
                }}
                disabled={readOnly}
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
            disabled={readOnly}
          />

          <Switch
            checked={field.required ?? false}
            onChange={(checked) => onChange(withBase(field, { required: checked }))}
            disabled={readOnly}
            label="Required"
          />

          {(field.type === 'select' || field.type === 'multiselect') && (
            <SelectOptionsConfig field={field} onChange={onChange} readOnly={readOnly} />
          )}
          {field.type === 'number' && (
            <NumberConfig field={field} onChange={onChange} readOnly={readOnly} />
          )}
          {field.type === 'text' && (
            <TextConfig field={field} onChange={onChange} readOnly={readOnly} />
          )}
        </div>

        {canRemove && (
          <button
            onClick={onRemove}
            className="text-sm text-neutral-400 hover:text-red-600 transition-colors px-1"
            type="button"
            aria-label="Remove field"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};

const SelectOptionsConfig = ({
  field,
  onChange,
  readOnly,
}: {
  field: Extract<FormField, { type: 'select' | 'multiselect' }>;
  onChange: (next: FormField) => void;
  readOnly: boolean;
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
              disabled={readOnly}
            />
          </div>
          {!readOnly && (
            <button
              onClick={() => setOptions(field.options.filter((o) => o.id !== option.id))}
              className="text-sm text-neutral-400 hover:text-red-600 transition-colors px-1"
              type="button"
              aria-label="Remove option"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {!readOnly && (
        <button
          onClick={addOption}
          className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          type="button"
        >
          + Add option
        </button>
      )}
    </div>
  );
};

const NumberConfig = ({
  field,
  onChange,
  readOnly,
}: {
  field: Extract<FormField, { type: 'number' }>;
  onChange: (next: FormField) => void;
  readOnly: boolean;
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
          disabled={readOnly}
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
          disabled={readOnly}
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
          disabled={readOnly}
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
          disabled={readOnly}
        />
      </div>
      <Switch
        checked={field.slider ?? false}
        onChange={(checked) => onChange({ ...field, slider: checked })}
        disabled={readOnly || !boundsSet}
        label="Show as slider"
      />
    </div>
  );
};

const TextConfig = ({
  field,
  onChange,
  readOnly,
}: {
  field: Extract<FormField, { type: 'text' }>;
  onChange: (next: FormField) => void;
  readOnly: boolean;
}) => (
  <Switch
    checked={field.multiline ?? false}
    onChange={(checked) => onChange({ ...field, multiline: checked })}
    disabled={readOnly}
    label="Multiline"
  />
);
