import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { exportAnnotations, exportAnnotationsGeojson } from '~/api/client';
import { useDismissOnOutside } from '~/shared/hooks/useDismissOnOutside';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Dropdown } from '~/shared/ui/motion';
import { IconChevronDownFilled, IconDownloadFilled } from '~/shared/ui/Icons';
import { handleError } from '~/shared/utils/errorHandler';
import {
  exportRows,
  resolveExportFilename,
  parseExportErrorDetail,
  type ExportFormat,
} from '../../campaign/tasks';

export interface ExportMenuProps {
  campaignId: number;
  campaignName: string;
  isTaskMode: boolean;
  hasConflicts: boolean;
}

function isBlob(body: unknown): body is Blob {
  return body instanceof Blob;
}

function hasStringDetail(error: unknown): error is { detail: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'detail' in error &&
    typeof error.detail === 'string'
  );
}

/** A failed export never reaches `data`: the client puts the body in `error`,
 *  already JSON-parsed when it was JSON. */
function exportErrorDetail(error: unknown): string | null {
  if (typeof error === 'string') return parseExportErrorDetail(error);
  return hasStringDetail(error) ? error.detail : null;
}

/** Triggers a browser download for a blob response. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export function ExportMenu({
  campaignId,
  campaignName,
  isTaskMode,
  hasConflicts,
}: ExportMenuProps) {
  const { t } = useTranslation('annotation');
  const [open, setOpen] = useState(false);
  const [mergeOnAgreement, setMergeOnAgreement] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const showAlert = useLayoutStore((s) => s.showAlert);

  useDismissOnOutside(containerRef, () => setOpen(false), open);

  useEffect(() => {
    if (hasConflicts && mergeOnAgreement) setMergeOnAgreement(false);
  }, [hasConflicts, mergeOnAgreement]);

  const handleExport = async (format: ExportFormat) => {
    setOpen(false);
    setExporting(format);
    try {
      const request = exportRows(campaignId, mergeOnAgreement);
      const fetcher = format === 'geojson' ? exportAnnotationsGeojson : exportAnnotations;
      const result = await fetcher(request);
      const body = isBlob(result.data) ? result.data : null;

      if (!result.response.ok || !body) {
        const detail = exportErrorDetail(result.error);
        throw new Error(detail ?? t('export.failedAs', { format: format.toUpperCase() }));
      }

      const contentDisposition = result.response.headers.get('Content-Disposition');
      const filename = resolveExportFilename(campaignName, format, contentDisposition);
      downloadBlob(body, filename);
      showAlert(t('export.done', { format: format.toUpperCase() }), 'success');
    } catch (err) {
      handleError(err, t('export.failed'));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={exporting !== null}
        className={`flex items-center gap-1 desktop:gap-2 px-2 desktop:px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded transition-colors ${open ? 'bg-neutral-100' : ''} ${exporting ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={t('export.title')}
        data-testid="export-menu-trigger"
      >
        <IconDownloadFilled className="w-4 h-4" />
        <span className="hidden desktop:inline">
          {exporting ? t('export.exporting') : t('export.label')}
        </span>
        <IconChevronDownFilled className="hidden desktop:block w-3 h-3" />
      </button>
      <Dropdown open={open} className="absolute top-full left-0 mt-1 z-20 origin-top-left">
        <div
          className="bg-white border border-neutral-200 rounded-lg shadow-lg min-w-[240px]"
          data-testid="export-menu"
        >
          {isTaskMode && (
            <label
              className={`flex items-start gap-2 px-3 py-2 border-b border-neutral-200 ${hasConflicts ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-neutral-50'}`}
              title={hasConflicts ? t('export.mergeDisabledTip') : undefined}
            >
              <input
                type="checkbox"
                checked={mergeOnAgreement}
                disabled={hasConflicts}
                onChange={(e) => setMergeOnAgreement(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-[11px] leading-snug text-neutral-700">
                <span className="font-medium block">{t('export.merge')}</span>
                <span className="text-neutral-500">
                  {hasConflicts ? t('export.mergeDisabled') : t('export.mergeHint')}
                </span>
              </span>
            </label>
          )}
          <button
            type="button"
            onClick={() => handleExport('geojson')}
            className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 transition-colors text-neutral-900"
          >
            <div className="font-medium">GeoJSON</div>
            <div className="text-[10px] text-neutral-500">{t('export.geojsonHint')}</div>
          </button>
          <button
            type="button"
            onClick={() => handleExport('csv')}
            className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 transition-colors text-neutral-900 border-t border-neutral-200"
          >
            <div className="font-medium">CSV</div>
            <div className="text-[10px] text-neutral-500">{t('export.csvHint')}</div>
          </button>
        </div>
      </Dropdown>
    </div>
  );
}
