import React from 'react';
import type { TimeSeriesCreate, TimeSeriesOut } from '~/api/client';
import { StepAddTimeseries } from '~/features/campaigns/creation/steps/StepAddTimeseries';

interface Props {
  newTimeseries: TimeSeriesCreate[];
  setNewTimeseries: (items: TimeSeriesCreate[]) => void;
  timeseries: TimeSeriesOut[];
  handleAddTimeseries: () => Promise<void>;
  setDeleteConfirm: (v: { timeseriesId?: number } | null) => void;
  saving: boolean;
  campaignName: string;
  imagery: any[];
  campaignMode: string;
  campaignSettings?: any;
}

export const TimeseriesTab: React.FC<Props> = ({
  newTimeseries,
  setNewTimeseries,
  timeseries,
  handleAddTimeseries,
  setDeleteConfirm,
  saving,
  campaignName,
  imagery,
  campaignMode,
  campaignSettings,
}) => {
  return (
    <div id="tab-timeseries" role="tabpanel" className="space-y-3">
      <div className="bg-white rounded-lg border border-neutral-300 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4">Add Timeseries</h2>
        <StepAddTimeseries
          form={{
            name: campaignName,
            mode: (campaignMode as any) || 'tasks',
            settings: (typeof (campaignSettings as any) !== 'undefined' ? campaignSettings : {}),
            imagery_configs: imagery.map((img) => ({ ...img, search_body: JSON.stringify(img.search_body) })),
            timeseries_configs: newTimeseries,
          }}
          setForm={(form: any) => setNewTimeseries(form.timeseries_configs || [])}
        />

        {newTimeseries.length > 0 && (
          <button
            type="button"
            onClick={handleAddTimeseries}
            disabled={saving}
            className="mt-4 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-200 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            Add {newTimeseries.length} Timeseries
          </button>
        )}
      </div>

      {timeseries.length > 0 && (
        <div className="bg-white rounded-lg border border-neutral-300 p-6">
          <h2 className="text-lg font-semibold text-neutral-900 mb-4">Existing Timeseries ({timeseries.length})</h2>
          <div className="space-y-3">
            {timeseries.map((ts) => (
              <div key={ts.id} className="rounded-lg border border-neutral-300 p-4 flex justify-between items-start">
                <div>
                  <h4 className="font-medium text-neutral-900">{ts.name}</h4>
                  <p className="text-sm text-neutral-500 mt-1">Start: {ts.start_ym} | End: {ts.end_ym}</p>
                </div>
                <button
                  onClick={() => setDeleteConfirm({ timeseriesId: ts.id })}
                  className="text-sm text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeseriesTab;
