import React, { useState } from 'react';
import { exportTaskAssignments, importTaskAssignments } from '~/api/client';
import { Button } from '~/shared/ui/forms';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { handleError } from '~/shared/utils/errorHandler';

interface Props {
  campaignId: number;
  campaignName: string;
  /** Called after a successful import so the caller can refetch tasks. */
  onImported: () => Promise<void> | void;
}

export const TaskAssignmentsExportImport: React.FC<Props> = ({
  campaignId,
  campaignName,
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

  return (
    <section className="space-y-4 pt-6 mt-6 border-t border-neutral-100">
      <div>
        <h2 className="section-heading">Export / import assignments</h2>
        <p className="section-description">
          Export assignees and reviewers as CSV, edit, and re-upload to apply changes.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <Button onClick={handleExport} disabled={exporting} variant="secondary">
          {exporting ? 'Exporting…' : 'Export'}
        </Button>

        <div className="flex gap-3 items-center flex-1">
          <label
            className={`flex-1 flex items-center gap-3 h-9 px-1 pr-3 border border-neutral-300 rounded-md bg-white transition-colors ${
              importing
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer hover:border-neutral-400'
            }`}
          >
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              disabled={importing}
              className="sr-only"
            />
            <span className="inline-flex items-center h-7 px-3 rounded text-xs font-medium bg-neutral-100 text-neutral-700 shrink-0">
              Choose CSV
            </span>
            <span className="text-xs text-neutral-500 truncate">
              {importFile ? importFile.name : 'No file selected'}
            </span>
          </label>
          <Button onClick={handleImport} disabled={!importFile || importing}>
            {importing ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </div>
    </section>
  );
};

export default TaskAssignmentsExportImport;
