import type { DateRangeValue } from '~/api/client';
import type { FormField, FormValues } from '../utils/formValues';
import { applyCategoryOption, isDateRangeValue, setFieldValue } from '../utils/formValues';

interface AnnotationFormProps {
  fields: FormField[];
  values: FormValues;
  onChange: (next: FormValues) => void;
  activeFieldIndex: number | null;
  disabled?: boolean;
}

const optionButtonClass = (selected: boolean, disabled: boolean) =>
  `w-40 text-left px-2.5 py-1.5 text-[11px] font-medium rounded transition-colors flex justify-between items-center ${
    selected
      ? 'bg-brand-50 text-brand-700 border-brand-600 border font-semibold'
      : 'bg-neutral-50 hover:bg-neutral-100 hover:border-neutral-400 text-neutral-700 border-neutral-200 border'
  } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`;

const textInputClass =
  'w-full px-2.5 py-2 text-xs text-neutral-900 bg-white border border-neutral-300 rounded-md focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 disabled:bg-neutral-50 disabled:opacity-60 placeholder:text-neutral-400 transition-colors';

const textareaClass = `${textInputClass} resize-none`;

function readDateRange(values: FormValues, fieldId: number): DateRangeValue {
  const raw = values[String(fieldId)];
  return isDateRangeValue(raw) ? raw : { start: '', end: '' };
}

function applyDateRangeSide(
  values: FormValues,
  field: FormField,
  side: 'start' | 'end',
  newValue: string
): FormValues {
  const current = readDateRange(values, field.id);

  if (newValue === '') {
    return setFieldValue(values, field.id, null);
  }

  let start = side === 'start' ? newValue : current.start;
  let end = side === 'end' ? newValue : current.end;
  if (start === '') start = newValue;
  if (end === '') end = newValue;

  // Backend rejects inverted ranges - clamp the other side to match
  // whichever end the user just moved past it.
  if (side === 'start' && start > end) end = start;
  if (side === 'end' && end < start) start = end;

  return setFieldValue(values, field.id, { start, end });
}

function FieldHeader({ field }: { field: FormField }) {
  return (
    <div className="flex items-center gap-1 text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
      <span>{field.title}</span>
      {field.required && <span className="text-red-500">*</span>}
      {field.description && (
        <span className="cursor-help text-neutral-400 normal-case" title={field.description}>
          ?
        </span>
      )}
    </div>
  );
}

function CategoryField({
  field,
  values,
  onChange,
  disabled,
}: {
  field: Extract<FormField, { type: 'category' | 'multicategory' }>;
  values: FormValues;
  onChange: (next: FormValues) => void;
  disabled: boolean;
}) {
  const raw = values[String(field.id)];
  const isSelected = (optionId: number) =>
    field.type === 'multicategory'
      ? Array.isArray(raw) && raw.includes(optionId)
      : raw === optionId;

  const handleClick = (optionId: number) => onChange(applyCategoryOption(values, field, optionId));

  return (
    <div className="flex flex-wrap gap-1.5">
      {field.options.map((option, index) => {
        const selected = isSelected(option.id);
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            className={optionButtonClass(selected, disabled)}
            onClick={() => handleClick(option.id)}
          >
            <span className="truncate">
              {selected ? '✓ ' : ''}
              {option.name}
            </span>
            <span className="text-neutral-400 text-[10px] ml-1 tabular-nums">{index + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

function NumberField({
  field,
  values,
  onChange,
  disabled,
}: {
  field: Extract<FormField, { type: 'number' }>;
  values: FormValues;
  onChange: (next: FormValues) => void;
  disabled: boolean;
}) {
  const raw = values[String(field.id)];
  const numericValue = typeof raw === 'number' ? raw : undefined;
  const step = field.step ?? (field.number_type === 'int' ? 1 : undefined);

  const clamp = (value: number) => {
    let result = field.number_type === 'int' ? Math.round(value) : value;
    if (field.min != null) result = Math.max(field.min, result);
    if (field.max != null) result = Math.min(field.max, result);
    return result;
  };

  // Clamping happens on blur, not per keystroke: clamping while typing garbles
  // entry whenever min has 2+ digits (typing "2015" with min 1990 would clamp
  // the intermediate "2" to 1990). Round for int fields immediately since that
  // never conflicts with a digit prefix. Enter-to-submit cannot bypass the
  // blur clamp: the keyboard hooks skip all shortcuts while an input is focused.
  const handleChange = (rawValue: string) => {
    if (rawValue === '') {
      onChange(setFieldValue(values, field.id, null));
      return;
    }
    const parsed = Number(rawValue);
    if (Number.isNaN(parsed)) {
      onChange(setFieldValue(values, field.id, null));
      return;
    }
    onChange(
      setFieldValue(values, field.id, field.number_type === 'int' ? Math.round(parsed) : parsed)
    );
  };

  const handleBlur = () => {
    if (numericValue === undefined) return;
    const clamped = clamp(numericValue);
    if (clamped !== numericValue) {
      onChange(setFieldValue(values, field.id, clamped));
    }
  };

  if (field.slider && field.min != null && field.max != null) {
    const sliderValue = numericValue ?? field.min;
    return (
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={field.min}
          max={field.max}
          step={step}
          value={sliderValue}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
          className="w-full h-2 bg-neutral-200 rounded-full appearance-none cursor-pointer accent-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <span className="text-xs text-brand-700 font-semibold tabular-nums w-10 text-right">
          {sliderValue}
        </span>
      </div>
    );
  }

  return (
    <input
      type="number"
      value={numericValue ?? ''}
      min={field.min ?? undefined}
      max={field.max ?? undefined}
      step={step}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      disabled={disabled}
      className={textInputClass}
    />
  );
}

function TextField({
  field,
  values,
  onChange,
  disabled,
}: {
  field: Extract<FormField, { type: 'text' }>;
  values: FormValues;
  onChange: (next: FormValues) => void;
  disabled: boolean;
}) {
  const raw = values[String(field.id)];
  const stringValue = typeof raw === 'string' ? raw : '';

  const handleChange = (value: string) => {
    onChange(setFieldValue(values, field.id, value === '' ? null : value));
  };

  if (field.multiline) {
    return (
      <textarea
        value={stringValue}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        rows={3}
        maxLength={5000}
        className={textareaClass}
      />
    );
  }

  return (
    <input
      type="text"
      value={stringValue}
      onChange={(e) => handleChange(e.target.value)}
      disabled={disabled}
      maxLength={500}
      className={textInputClass}
    />
  );
}

// The generated schema gives 'date' and 'daterange' the same DateFormField
// shape (only the runtime type tag differs), so Extract can't split them
// into two member types - branch on field.type inside a single component.
function DateFamilyField({
  field,
  values,
  onChange,
  disabled,
}: {
  field: Extract<FormField, { type: 'date' | 'daterange' }>;
  values: FormValues;
  onChange: (next: FormValues) => void;
  disabled: boolean;
}) {
  if (field.type === 'daterange') {
    const { start, end } = readDateRange(values, field.id);
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-neutral-500 w-8">From</label>
          <input
            type="date"
            value={start}
            onChange={(e) => onChange(applyDateRangeSide(values, field, 'start', e.target.value))}
            disabled={disabled}
            className={textInputClass}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-neutral-500 w-8">To</label>
          <input
            type="date"
            value={end}
            onChange={(e) => onChange(applyDateRangeSide(values, field, 'end', e.target.value))}
            disabled={disabled}
            className={textInputClass}
          />
        </div>
      </div>
    );
  }

  const raw = values[String(field.id)];
  const stringValue = typeof raw === 'string' ? raw : '';

  return (
    <input
      type="date"
      value={stringValue}
      onChange={(e) =>
        onChange(setFieldValue(values, field.id, e.target.value === '' ? null : e.target.value))
      }
      disabled={disabled}
      className={textInputClass}
    />
  );
}

function FieldInput({
  field,
  values,
  onChange,
  disabled,
}: {
  field: FormField;
  values: FormValues;
  onChange: (next: FormValues) => void;
  disabled: boolean;
}) {
  switch (field.type) {
    case 'category':
    case 'multicategory':
      return (
        <CategoryField field={field} values={values} onChange={onChange} disabled={disabled} />
      );
    case 'number':
      return <NumberField field={field} values={values} onChange={onChange} disabled={disabled} />;
    case 'text':
      return <TextField field={field} values={values} onChange={onChange} disabled={disabled} />;
    case 'date':
    case 'daterange':
      return (
        <DateFamilyField field={field} values={values} onChange={onChange} disabled={disabled} />
      );
  }
}

export const AnnotationForm: React.FC<AnnotationFormProps> = ({
  fields,
  values,
  onChange,
  activeFieldIndex,
  disabled = false,
}) => {
  if (fields.length === 0) return null;

  return (
    <>
      {fields.map((field, index) => (
        <div
          key={field.id}
          data-form-field-id={field.id}
          className={`flex flex-col gap-1.5 p-3 border-r border-b border-neutral-100 flex-1 min-w-[10rem] ${
            // ring-inset matches the label section and avoids the ring being
            // clipped by the scroll container / adjacent sections.
            activeFieldIndex === index ? 'ring-2 ring-inset ring-brand-500/40 rounded' : ''
          }`}
        >
          <FieldHeader field={field} />
          <FieldInput field={field} values={values} onChange={onChange} disabled={disabled} />
        </div>
      ))}
    </>
  );
};

export default AnnotationForm;
