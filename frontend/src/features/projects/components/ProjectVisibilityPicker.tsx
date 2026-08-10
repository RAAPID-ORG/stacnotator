import type { ProjectVisibility } from './projectVisibility';

const OPTIONS: { value: ProjectVisibility; label: string; description: string }[] = [
  {
    value: 'private',
    label: 'Private',
    description: 'Only invited members can see and open this project.',
  },
  {
    value: 'organization',
    label: 'Organization',
    description:
      'Everyone in the owning organization can open this project and work on its campaigns.',
  },
  {
    value: 'public',
    label: 'Public',
    description:
      'Anyone signed in to the platform can open this project and work on its campaigns.',
  },
];

interface ProjectVisibilityPickerProps {
  value: ProjectVisibility;
  onChange: (visibility: ProjectVisibility) => void;
  disabled?: boolean;
  /** Keeps radio group names unique when the picker appears twice in a page. */
  name?: string;
}

export const ProjectVisibilityPicker = ({
  value,
  onChange,
  disabled,
  name = 'project-visibility',
}: ProjectVisibilityPickerProps) => (
  <div role="radiogroup" aria-label="Project visibility" className="space-y-2">
    {OPTIONS.map((option) => {
      const selected = value === option.value;
      return (
        <label
          key={option.value}
          data-testid={`visibility-option-${option.value}`}
          className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
            selected
              ? 'border-brand-300 bg-brand-50/50'
              : 'border-neutral-200 bg-white hover:border-neutral-300'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={selected}
            onChange={() => onChange(option.value)}
            disabled={disabled}
            className="mt-0.5 text-brand-600 focus:ring-brand-600"
          />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-neutral-900">{option.label}</span>
            <span className="block text-xs text-neutral-500 leading-snug">
              {option.description}
            </span>
          </span>
        </label>
      );
    })}
  </div>
);
