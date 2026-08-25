import { useId, useState, type ReactNode } from 'react';
import { IconChevronDown, IconChevronRight } from '~/shared/ui/Icons';

interface CollapsibleSectionProps {
  title: string;
  /** Sits under the title, visible whether or not the section is open. */
  description?: ReactNode;
  /** Rendered on the header row, right of the toggle - a count, a status, a total. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * A section that opens on demand, in the platform's own idiom.
 *
 * The header is the control: whole-width, quiet until hovered, with a chevron on the
 * left the way a disclosure reads everywhere else here. Deliberately not a pill button
 * floated to the right - that was a shape this design language uses nowhere, and it
 * read as a stray control rather than as part of the section it opened.
 *
 * Content is unmounted while closed rather than hidden, so a section that fetches on
 * mount does not pay for itself until someone asks for it.
 */
export const CollapsibleSection = ({
  title,
  description,
  meta,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div>
      {/* The heading wraps the button rather than sitting inside it: that is the ARIA
          disclosure pattern, and it keeps the title a real heading for anyone
          navigating by them. */}
      <h2 className="section-heading mb-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="group flex w-full items-center gap-2 text-left -mx-2 px-2 py-1 rounded-lg hover:bg-neutral-50 transition-colors"
        >
          <span className="text-neutral-400 group-hover:text-neutral-600 transition-colors">
            {open ? (
              <IconChevronDown className="w-4 h-4" />
            ) : (
              <IconChevronRight className="w-4 h-4" />
            )}
          </span>
          <span className="flex-1 min-w-0">{title}</span>
          {meta && <span className="text-xs text-neutral-400 font-normal">{meta}</span>}
        </button>
      </h2>

      {description && <p className="section-description mb-0 mt-1 pl-6">{description}</p>}

      {open && (
        <div id={panelId} className="mt-4">
          {children}
        </div>
      )}
    </div>
  );
};
