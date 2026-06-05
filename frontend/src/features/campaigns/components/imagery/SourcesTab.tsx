import { useState } from 'react';
import { IconPlus, IconSettings } from '~/shared/ui/Icons';
import type { ImageryController } from './controller';
import { AddSourceWizard } from './AddSourceWizard';
import { SourceEditor } from './SourceEditor';
import type { ImagerySource } from './types';

interface SourcesTabProps {
  controller: ImageryController;
  campaignBbox?: number[] | null;
}

export const SourcesTab = ({ controller, campaignBbox = null }: SourcesTabProps) => {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const sources = controller.state.sources;
  const editing: ImagerySource | undefined = editingId
    ? sources.find((s) => s.id === editingId)
    : undefined;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-neutral-500 mt-0.5">
          Define where imagery comes from. Each source represents a dataset (e.g. Sentinel-2,
          Landsat, NAIP) with collections covering specific time periods.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {sources.map((source) => (
          <button
            key={source.id}
            type="button"
            onClick={() => setEditingId(source.id)}
            title="Click to configure"
            className="group relative flex items-center justify-center rounded-lg border-2 transition-all cursor-pointer px-4 py-3 shrink-0 border-neutral-200 bg-white text-neutral-800 hover:border-brand-400 hover:bg-brand-700/10"
          >
            <IconSettings className="absolute inset-0 m-auto w-4 h-4 transition-opacity opacity-0 group-hover:opacity-100 text-brand-600" />
            <span className="text-xs font-medium leading-tight truncate max-w-[120px] transition-opacity group-hover:opacity-0">
              {source.name || 'Untitled'}
            </span>
          </button>
        ))}

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
          campaignBbox={campaignBbox}
          onClose={() => setWizardOpen(false)}
        />
      )}

      {editing && (
        <SourceEditor
          source={editing}
          controller={controller}
          campaignBbox={campaignBbox}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
};
