import { answeredFields, type FormField, type FormValues } from '~/shared/utils/formValues';

/**
 * A stored annotation's custom-form answers, read only.
 *
 * The editable FormFields renderer is not reusable here: its `disabled` prop
 * greys out real inputs rather than dropping them, which in a table row reads
 * as a form somebody could type into.
 */
export function FormAnswers({
  fields,
  values,
}: {
  fields: FormField[];
  values: FormValues | null | undefined;
}) {
  const answered = answeredFields(fields, values);

  if (answered.length === 0) {
    return <p className="text-xs text-neutral-400">No answers recorded.</p>;
  }

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5" data-testid="form-answers">
      {answered.map(({ field, text }) => (
        <div key={field.id} className="contents">
          <dt className="text-[11px] font-medium text-neutral-500">{field.title}</dt>
          <dd className="text-xs break-words text-neutral-800">{text}</dd>
        </div>
      ))}
    </dl>
  );
}
