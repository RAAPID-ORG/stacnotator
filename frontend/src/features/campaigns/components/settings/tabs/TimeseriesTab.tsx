import React from 'react';
import type {
  ImagerySourceOut,
  TimeSeriesCreate,
  TimeSeriesOut,
  CampaignSettingsOut,
} from '~/api/client';
import { StepAddTimeseries } from '~/features/campaigns/components/creation/steps/StepAddTimeseries';
import { Button } from '~/shared/ui/forms';
import { IconWindow } from '~/shared/ui/Icons';

interface Props {
  newTimeseries: TimeSeriesCreate[];
  setNewTimeseries: (items: TimeSeriesCreate[]) => void;
  timeseries: TimeSeriesOut[];
  handleAddTimeseries: () => Promise<void>;
  setDeleteConfirm: (v: { timeseriesId?: number } | null) => void;
  saving: boolean;
  campaignName: string;
  imagery: ImagerySourceOut[];
  campaignMode: 'tasks' | 'open';
  campaignSettings?: CampaignSettingsOut;
}

/** Group existing series by their window for display, unnamed series first
 *  under the default window. Order follows first appearance. */
function groupExistingByWindow(
  timeseries: TimeSeriesOut[]
): { title: string; series: TimeSeriesOut[] }[] {
  const groups: { title: string; series: TimeSeriesOut[] }[] = [];
  const byTitle = new Map<string, { title: string; series: TimeSeriesOut[] }>();
  for (const ts of timeseries) {
    const title = ts.window_name?.trim() || 'Default window';
    let group = byTitle.get(title);
    if (!group) {
      group = { title, series: [] };
      byTitle.set(title, group);
      groups.push(group);
    }
    group.series.push(ts);
  }
  return groups;
}

export const TimeseriesTab: React.FC<Props> = ({
  newTimeseries,
  setNewTimeseries,
  timeseries,
  handleAddTimeseries,
  setDeleteConfirm,
  saving,
  campaignName,
  imagery: _imagery,
  campaignMode,
  campaignSettings,
}) => {

  const knownWindowNames = Array.from(
    new Set(timeseries.map((t) => t.window_name?.trim()).filter((n): n is string => !!n))
  );

  return (
    <div id="tab-timeseries" role="tabpanel">
      <section className="space-y-4">
        <div>
          <h2 className="section-heading">Add timeseries</h2>
          <p className="section-description">
            Time series show how a location changes over time using spectral indices (e.g. NDVI,
            NDWI). They are displayed as interactive charts alongside imagery during annotation to
            provide temporal context.
          </p>
        </div>
        <StepAddTimeseries
          form={
            {
              name: campaignName,
              mode: campaignMode,
              settings: campaignSettings ?? ({} as CampaignSettingsOut),
              imagery_editor_state: null,
              timeseries_configs: newTimeseries,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- form shape adaptor between CampaignSettingsOut and CampaignCreate
            } as any
          }
          setForm={(form: Record<string, unknown>) =>
            setNewTimeseries((form.timeseries_configs as TimeSeriesCreate[]) || [])
          }
          knownWindowNames={knownWindowNames}
        />

        {newTimeseries.length > 0 && (
          <Button onClick={handleAddTimeseries} disabled={saving}>
            Add {newTimeseries.length} timeseries
          </Button>
        )}
      </section>

      {timeseries.length > 0 && (
        <section className="mt-8 pt-6 border-t border-neutral-100 space-y-3">
          <h2 className="section-heading">
            Existing timeseries{' '}
            <span className="text-neutral-400 font-normal">({timeseries.length})</span>
          </h2>
          <p className="section-description">
            Series are grouped into the panel they appear in on the annotation page.
          </p>
          {groupExistingByWindow(timeseries).map(({ title, series }) => (
            <div key={title} className="rounded-lg border border-neutral-200 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-neutral-50 border-b border-neutral-200">
                <IconWindow className="w-4 h-4 text-neutral-400 shrink-0" />
                <span className="text-sm font-medium text-neutral-800">{title}</span>
                <span className="text-xs text-neutral-400 tabular-nums">({series.length})</span>
              </div>
              <ul className="divide-y divide-neutral-100">
                {series.map((ts) => (
                  <li key={ts.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-neutral-900">{ts.name}</div>
                      <div className="text-xs text-neutral-500 mt-0.5">
                        {ts.start_ym} – {ts.end_ym}
                      </div>
                    </div>
                    <button
                      onClick={() => setDeleteConfirm({ timeseriesId: ts.id })}
                      className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer shrink-0"
                      type="button"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
};

export default TimeseriesTab;
