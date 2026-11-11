import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomIndexIn, CustomIndexOut, TimeseriesCreate, TimeseriesOut } from '~/api/client';
import { StepAddTimeseries } from '~/features/campaigns/components/creation/steps/StepAddTimeseries';
import { Button } from '~/shared/ui/forms';

interface Props {
  newTimeseries: TimeseriesCreate[];
  setNewTimeseries: (items: TimeseriesCreate[]) => void;
  timeseries: TimeseriesOut[];
  handleAddTimeseries: () => void;
  handleRenamePanel: (oldName: string, newName: string) => Promise<void>;
  setDeleteConfirm: (v: { timeseriesId?: number } | null) => void;
  customIndices: CustomIndexOut[];
  handleSaveCustomIndex: (body: CustomIndexIn, original: string | null) => Promise<void>;
  handleRemoveCustomIndex: (name: string) => void;
  saving: boolean;
}

export const TimeseriesTab: React.FC<Props> = ({
  newTimeseries,
  setNewTimeseries,
  timeseries,
  handleAddTimeseries,
  handleRenamePanel,
  setDeleteConfirm,
  customIndices,
  handleSaveCustomIndex,
  handleRemoveCustomIndex,
  saving,
}) => {
  const { t } = useTranslation('campaigns');
  const knownWindowNames = Array.from(
    new Set(timeseries.map((t) => t.window_name?.trim()).filter((n): n is string => !!n))
  );

  return (
    <div id="tab-timeseries" role="tabpanel">
      <section className="space-y-4">
        <StepAddTimeseries
          items={newTimeseries}
          onChange={setNewTimeseries}
          knownWindowNames={knownWindowNames}
          existingTimeseries={timeseries}
          onRemoveExisting={(timeseriesId) => setDeleteConfirm({ timeseriesId })}
          onRenameExistingPanel={handleRenamePanel}
          customIndices={customIndices}
          onSaveCustomIndex={handleSaveCustomIndex}
          onRemoveCustomIndex={handleRemoveCustomIndex}
          saving={saving}
        />

        {newTimeseries.length > 0 && (
          <Button onClick={handleAddTimeseries} disabled={saving}>
            {t('settingsPage.timeseries.addCount', { count: newTimeseries.length })}
          </Button>
        )}
      </section>
    </div>
  );
};
