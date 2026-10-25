import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { exportAnnotations, exportAnnotationsGeojson } from '~/api/client';
import {
  exportRows,
  parseExportErrorDetail,
  resolveExportFilename,
  type ExportFormat,
} from '~/features/campaigns/utils/annotationExport';
import { useDismissOnOutside } from '~/shared/hooks/useDismissOnOutside';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { IconChevronDownFilled, IconDownloadFilled } from '~/shared/ui/Icons';
import { Dropdown } from '~/shared/ui/motion';
import { Spinner } from '~/shared/ui/Spinner';
import { handleError } from '~/shared/utils/errorHandler';

interface ExportMenuProps {
  campaignId: number;
  campaignName: string;
  /** Offer merging agreeing task rows into one; only tasks have several annotators. */
  showMergeToggle: boolean;
  /** Merging is refused while tasks disagree, so the toggle says so instead. */
  hasConflicts?: boolean;
  disabled?: boolean;
  /** The annotation toolbar's compact trigger rather than a page button. */
  compact?: boolean;
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

/** Download a campaign's annotations as GeoJSON or CSV. */
export function ExportMenu({
  campaignId,
  campaignName,
  showMergeToggle,
  hasConflicts = false,
  disabled = false,
  compact = false,
}: ExportMenuProps) {
  const { t } = useTranslation('review');
  const [open, setOpen] = useState(false);
  const [mergeOnAgreement, setMergeOnAgreement] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const showAlert = useLayoutStore((s) => s.showAlert);

  useDismissOnOutside(containerRef, () => setOpen(false), open);

  // Conflicts can appear while the toggle is on; a merged export would be refused.
  useEffect(() => {
    if (hasConflicts && mergeOnAgreement) setMergeOnAgreement(false);
  }, [hasConflicts, mergeOnAgreement]);

  const handleExport = async (format: ExportFormat) => {
    setOpen(false);
    setExporting(format);
    try {
      const fetcher = format === 'geojson' ? exportAnnotationsGeojson : exportAnnotations;
      const result = await fetcher(exportRows(campaignId, mergeOnAgreement));
      const body = result.data instanceof Blob ? result.data : null;
      if (!result.response.ok || !body) {
        const detail = exportErrorDetail(result.error);
        throw new Error(detail ?? t('export.failedAs', { format: format.toUpperCase() }));
      }
      const contentDisposition = result.response.headers.get('Content-Disposition');
      downloadBlob(body, resolveExportFilename(campaignName, format, contentDisposition));
      showAlert(t('export.done', { format: format.toUpperCase() }), 'success');
    } catch (err) {
      handleError(err, t('export.failed'));
    } finally {
      setExporting(null);
    }
  };

  const busy = exporting !== null;
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy || disabled}
        title={t('export.title')}
        data-testid="export-menu-trigger"
        className={
          compact
            ? `flex items-center gap-1 desktop:gap-2 px-2 desktop:px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${open ? 'bg-neutral-100' : ''}`
            : 'px-4 py-2 bg-white border border-neutral-300 text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2'
        }
      >
        {busy && !compact ? <Spinner size="xs" /> : <IconDownloadFilled className="w-4 h-4" />}
        <span className={compact ? 'hidden desktop:inline' : undefined}>
          {busy ? t('export.exporting') : t('export.label')}
        </span>
        <IconChevronDownFilled className={compact ? 'hidden desktop:block w-3 h-3' : 'w-3 h-3'} />
      </button>
      <Dropdown
        open={open}
        className={`absolute top-full mt-1 z-30 ${compact ? 'left-0 origin-top-left' : 'right-0 origin-top-right'}`}
      >
        <div
          className="bg-white border border-neutral-200 rounded-lg shadow-lg min-w-[240px]"
          data-testid="export-menu"
        >
          {showMergeToggle && (
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
          {(['geojson', 'csv'] as const).map((format, i) => (
            <button
              key={format}
              type="button"
              onClick={() => handleExport(format)}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 transition-colors text-neutral-900 ${i > 0 ? 'border-t border-neutral-200' : ''}`}
            >
              <div className="font-medium">{format === 'geojson' ? 'GeoJSON' : 'CSV'}</div>
              <div className="text-[10px] text-neutral-500">
                {format === 'geojson' ? t('export.geojsonHint') : t('export.csvHint')}
              </div>
            </button>
          ))}
        </div>
      </Dropdown>
    </div>
  );
}
