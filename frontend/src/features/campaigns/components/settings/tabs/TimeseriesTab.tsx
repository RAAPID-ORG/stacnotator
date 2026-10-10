import React from 'react';
import type {
  ImagerySourceOut,
  TimeSeriesCreate,
  TimeSeriesOut,
  CampaignSettingsOut,
} from '~/api/client';
import { StepAddTimeseries } from '~/features/campaigns/components/creation/steps/StepAddTimeseries';
import { Button } from '~/shared/ui/forms';

interface Props {
  newTimeseries: TimeSeriesCreate[];
  setNewTimeseries: (items: TimeSeriesCreate[]) => void;
  timeseries: TimeSeriesOut[];
  handleAddTimeseries: () => void;
  handleRenamePanel: (oldName: string, newName: string) => Promise<void>;
  setDeleteConfirm: (v: { timeseriesId?: number } | null) => void;
  saving: boolean;
  campaignName: string;
  imagery: ImagerySourceOut[];
  campaignMode: 'tasks' | 'open';
  campaignSettings?: CampaignSettingsOut;
}

export const TimeseriesTab: React.FC<Props> = ({
  newTimeseries,
  setNewTimeseries,
  timeseries,
  handleAddTimeseries,
  handleRenamePanel,
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
          existingTimeseries={timeseries}
          onRemoveExisting={(timeseriesId) => setDeleteConfirm({ timeseriesId })}
          onRenameExistingPanel={handleRenamePanel}
          saving={saving}
        />

        {newTimeseries.length > 0 && (
          <Button onClick={handleAddTimeseries} disabled={saving}>
            Add {newTimeseries.length} timeseries
          </Button>
        )}
      </section>
    </div>
  );
};

export default TimeseriesTab;
