import type { ComponentType } from 'react';
import { IconBuilding, IconCheck, IconGlobe, IconLock } from '~/shared/ui/Icons';
import type { ProjectVisibility } from './projectVisibility';

interface Option {
  value: ProjectVisibility;
  label: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
}

const OPTIONS: Option[] = [
  {
    value: 'private',
    label: 'Private',
    description: 'Only invited members can see and open this project.',
    Icon: IconLock,
  },
  {
    value: 'organization',
    label: 'Organization',
    description: 'Everyone in the owning organization can open it and work on its campaigns.',
    Icon: IconBuilding,
  },
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone signed in to the platform can open it and work on its campaigns.',
    Icon: IconGlobe,
  },
];

interface ProjectVisibilityPickerProps {
  value: ProjectVisibility;
  onChange: (visibility: ProjectVisibility) => void;
  disabled?: boolean;
  /** Keeps radio group names unique when the picker appears twice in a page. */
  name?: string;
}

/**
 * Three cards side by side rather than a stack of rows: the choice is between
 * three peers, and reading them next to each other is how you pick one.
 */
export const ProjectVisibilityPicker = ({
  value,
  onChange,
  disabled,
  name = 'project-visibility',
}: ProjectVisibilityPickerProps) => (
  <div
    role="radiogroup"
    aria-label="Project visibility"
    className="grid grid-cols-1 gap-3 desktop:grid-cols-3"
  >
    {OPTIONS.map(({ value: option, label, description, Icon }) => {
      const selected = value === option;
      return (
        <label
          key={option}
          data-testid={`visibility-option-${option}`}
          data-selected={selected}
          className={`relative flex flex-col gap-1.5 rounded-lg border p-3 transition-colors ${
            selected
              ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500'
              : 'border-neutral-200 bg-white hover:border-neutral-300'
          } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
        >
          <input
            type="radio"
            name={name}
            value={option}
            checked={selected}
            onChange={() => onChange(option)}
            disabled={disabled}
            className="sr-only"
          />
          <span className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${selected ? 'text-brand-700' : 'text-neutral-400'}`} />
            <span
              className={`text-sm font-medium ${selected ? 'text-brand-800' : 'text-neutral-900'}`}
            >
              {label}
            </span>
            {selected && <IconCheck className="ml-auto h-4 w-4 text-brand-600" />}
          </span>
          <span className="text-xs leading-snug text-neutral-500">{description}</span>
        </label>
      );
    })}
  </div>
);
