import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { exportTaskAssignments, importTaskAssignments } from '~/api/client';
import { Button } from '~/shared/ui/forms';
import { FileInput } from '~/shared/ui/FileInput';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';

interface Props {
  campaignId: number;
  campaignName: string;
  /** Narrows the export to one task set; omitted exports the whole campaign. */
  taskSetId?: number;
  /** Called after a successful import so the caller can refetch tasks. */
  onImported: () => Promise<void> | void;
}

export const TaskAssignmentsExportImport: React.FC<Props> = ({
  campaignId,
  campaignName,
  taskSetId,
  onImported,
}) => {
  const { t } = useTranslation('campaigns');
  const showAlert = useLayoutStore((state) => state.showAlert);
  const [exporting, setExporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await exportTaskAssignments({
        path: { campaign_id: campaignId },
        query: { task_set_id: taskSetId },
        parseAs: 'blob',
      });
      if (!response.response.ok || !response.data) {
        throw new Error(t('assignmentsIO.exportFailed'));
      }
      const blob = response.data as Blob;
      const safeName = campaignName.replace(/\s+/g, '_');
      let filename = `campaign_${safeName}_task_assignments.zip`;
      const disposition = response.response.headers.get('Content-Disposition');
      if (disposition) {
        const match = disposition.match(/filename="?(.+?)"?$/i);
        if (match) filename = match[1];
      }
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showAlert(t('assignmentsIO.exported'), 'success');
    } catch (err) {
      handleError(err, t('assignmentsIO.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const { data } = await importTaskAssignments({
        path: { campaign_id: campaignId },
        body: { file: importFile } as never,
      });
      setImportFile(null);
      await onImported();
      const summary = data
        ? t('assignmentsIO.importSummary', {
            tasks: data.tasks_updated,
            assignees: data.assignees_created,
            reviewers: data.reviewers_created,
          })
        : t('assignmentsIO.imported');
      showAlert(summary, 'success');
    } catch (err) {
      handleError(err, t('assignmentsIO.importFailed'));
    } finally {
      setImporting(false);
    }
  };

  // Heading and description belong to whichever section hosts this - it is the controls
  // only, so a caller can put it behind a disclosure without two titles stacking up.
  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <Button onClick={handleExport} disabled={exporting} variant="secondary">
          {exporting ? t('assignmentsIO.exporting') : t('assignmentsIO.export')}
        </Button>

        <div className="flex gap-3 items-center flex-1">
          <FileInput
            accept=".csv"
            action={t('assignmentsIO.chooseCsv')}
            disabled={importing}
            className="flex-1"
            fileName={importFile?.name ?? null}
            onSelect={setImportFile}
          />
          <Button onClick={handleImport} disabled={!importFile || importing}>
            {importing ? t('assignmentsIO.importing') : t('assignmentsIO.import')}
          </Button>
        </div>
      </div>
      {taskSetId != null && (
        <p className="text-xs text-neutral-500">{t('assignmentsIO.taskSetScope')}</p>
      )}
    </div>
  );
};
