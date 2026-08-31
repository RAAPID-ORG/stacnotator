import { useState } from 'react';
import { IconCheck, IconPlus, IconSettings } from '~/shared/ui/Icons';
import type { ImageryController } from './controller';
import { sourceRegistration } from './controller';
import { AddSourceWizard } from './AddSourceWizard';

interface SourcesTabProps {
  controller: ImageryController;
  /** Open the shared source editor for the given source id. */
  onEditSource: (sourceId: string) => void;
  /** Replaces the default blurb, or drops it when null - a caller that has
   *  already said what these sources are does not want it said twice. */
  description?: string | null;
}

const DEFAULT_DESCRIPTION =
  'Define where imagery comes from. Each source represents a dataset (e.g. Sentinel-2, ' +
  'Landsat, NAIP) with collections covering specific time periods.';

export const SourcesTab = ({
  controller,
  onEditSource,
  description = DEFAULT_DESCRIPTION,
}: SourcesTabProps) => {
  const [wizardOpen, setWizardOpen] = useState(false);

  const sources = controller.state.sources;

  return (
    <div className="space-y-3">
      {description && <p className="text-xs text-neutral-500 mt-0.5">{description}</p>}

      <div className="flex flex-wrap gap-2">
        {sources.map((source) => {
          const registration = sourceRegistration(source, controller.campaignId);
          return (
            <button
              key={source.id}
              type="button"
              onClick={() => onEditSource(source.id)}
              title={
                registration
                  ? `Click to configure - ${registration.registered} of ${registration.total} slices registered`
                  : 'Click to configure'
              }
              className="group relative flex items-center justify-center rounded-lg border-2 transition-all cursor-pointer px-4 py-3 shrink-0 border-neutral-200 bg-white text-neutral-800 hover:border-brand-400 hover:bg-brand-700/10"
            >
              <IconSettings className="absolute inset-0 m-auto w-4 h-4 transition-opacity opacity-0 group-hover:opacity-100 text-brand-600" />
              <span className="text-xs font-medium leading-tight truncate max-w-[120px] transition-opacity group-hover:opacity-0">
                {source.name || 'Untitled'}
              </span>
              {registration && (
                <span
                  data-testid="source-registration-progress"
                  data-registered={registration.registered}
                  data-total={registration.total}
                  className="absolute top-1 right-1 transition-opacity group-hover:opacity-0"
                >
                  {registration.complete ? (
                    <IconCheck className="w-3 h-3 text-green-700" />
                  ) : (
                    <span className="text-[9px] font-medium text-amber-600">
                      {registration.percent}%
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="flex items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 hover:border-brand-400 hover:bg-brand-50/30 transition-all cursor-pointer px-4 py-3 shrink-0"
        >
          <IconPlus className="w-4 h-4 text-neutral-400" />
          <span className="text-[11px] text-neutral-500 ml-1">Create source</span>
        </button>
      </div>

      {wizardOpen && (
        <AddSourceWizard
          controller={controller}
          onClose={() => setWizardOpen(false)}
          onCreated={(sourceId) => {
            setWizardOpen(false);
            onEditSource(sourceId);
          }}
        />
      )}
    </div>
  );
};
