import React, { useState } from 'react';
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
        throw new Error('Failed to export task assignments');
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
      showAlert('Task assignments exported', 'success');
    } catch (err) {
      handleError(err, 'Failed to export task assignments');
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
        ? `Updated ${data.tasks_updated} task(s): ${data.assignees_created} assignee(s), ${data.reviewers_created} reviewer(s)`
        : 'Task assignments imported';
      showAlert(summary, 'success');
    } catch (err) {
      handleError(err, 'Failed to import task assignments');
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
          {exporting ? 'Exporting…' : 'Export'}
        </Button>

        <div className="flex gap-3 items-center flex-1">
          <FileInput
            accept=".csv"
            action="Choose CSV"
            disabled={importing}
            className="flex-1"
            fileName={importFile?.name ?? null}
            onSelect={setImportFile}
          />
          <Button onClick={handleImport} disabled={!importFile || importing}>
            {importing ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </div>
      {taskSetId != null && (
        <p className="text-xs text-neutral-500">
          Exports this task set only. Imports apply campaign-wide, matched on annotation number.
        </p>
      )}
    </div>
  );
};

export default TaskAssignmentsExportImport;
