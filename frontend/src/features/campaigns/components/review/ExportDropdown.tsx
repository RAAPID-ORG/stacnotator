import { useEffect, useRef, useState } from 'react';
import { useLayoutStore } from '~/features/layout/layout.store';
import { exportAnnotations, exportAnnotationsGeojson, type CampaignOut } from '~/api/client';
import { Dropdown } from '~/shared/ui/motion';
import { handleError } from '~/shared/utils/errorHandler';

interface ExportDropdownProps {
  campaignId: number;
  campaign: CampaignOut;
  disabled: boolean;
  /** Show the "merge on agreement" toggle. Hidden in open mode where it
   *  has no meaning (no tasks, no multi-annotator merging). Default true. */
  showMergeToggle?: boolean;
  /** Disables the merge toggle with a tooltip explaining the user must
   *  resolve conflicts first. Required when showMergeToggle is true. */
  hasConflicts?: boolean;
}

export const ExportDropdown = ({
  campaignId,
  campaign,
  disabled,
  showMergeToggle = true,
  hasConflicts = false,
}: ExportDropdownProps) => {
  const [exporting, setExporting] = useState<'csv' | 'geojson' | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [mergeOnAgreement, setMergeOnAgreement] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const showAlert = useLayoutStore((state) => state.showAlert);

  // If conflicts appear (e.g. data refreshes) while merge is checked, force
  // it back off so the user can't submit a request that we know will 400.
  useEffect(() => {
    if (hasConflicts && mergeOnAgreement) setMergeOnAgreement(false);
  }, [hasConflicts, mergeOnAgreement]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = async (format: 'csv' | 'geojson') => {
    setExporting(format);
    setShowDropdown(false);
    try {
      const fetcher = format === 'geojson' ? exportAnnotationsGeojson : exportAnnotations;
      const response = await fetcher({
        path: { campaign_id: campaignId },
        query: mergeOnAgreement ? { merge_on_agreement: true } : undefined,
        parseAs: 'blob',
      });
      if (!response.response.ok || !response.data) {
        // Try to surface the backend's specific error (e.g. the list of
        // conflicting task numbers when merge_on_agreement is rejected).
        let detail = `Failed to export annotations as ${format.toUpperCase()}`;
        try {
          const errBlob = response.data as Blob | undefined;
          if (errBlob) {
            const text = await errBlob.text();
            const parsed = JSON.parse(text) as { detail?: string };
            if (parsed.detail) detail = parsed.detail;
          }
        } catch {
          // body wasn't JSON - fall through with the generic message
        }
        throw new Error(detail);
      }
      const blob = response.data as Blob;
      const ext = format === 'geojson' ? 'geojson' : 'csv';
      const contentDisposition = response.response.headers.get('Content-Disposition');
      let filename = `campaign_${campaign.name.replace(/\s+/g, '_')}_annotations.${ext}`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
        if (filenameMatch) filename = filenameMatch[1];
      }
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showAlert(`Annotations exported as ${format.toUpperCase()}`, 'success');
    } catch (err) {
      handleError(err, 'Failed to export annotations');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={exporting !== null || disabled}
        className="px-4 py-2 bg-white border border-neutral-300 text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {exporting ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Exporting…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Export
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </>
        )}
      </button>
      <Dropdown
        open={showDropdown}
        className="absolute right-0 top-full mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-20 min-w-[260px] origin-top-right"
      >
        <div>
          {showMergeToggle && (
            <label
              className={`flex items-start gap-2 px-4 py-2.5 border-b border-neutral-200 ${
                hasConflicts
                  ? 'cursor-not-allowed opacity-60'
                  : 'cursor-pointer hover:bg-neutral-50'
              }`}
              title={
                hasConflicts
                  ? 'Disabled: this campaign has conflicting tasks. Resolve them in review mode before merging on agreement.'
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={mergeOnAgreement}
                disabled={hasConflicts}
                onChange={(e) => setMergeOnAgreement(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs leading-snug text-neutral-700">
                <span className="font-medium block">Merge on agreement</span>
                <span className="text-neutral-500">
                  {hasConflicts
                    ? 'Disabled - resolve conflicting tasks first.'
                    : 'Collapse multi-annotator tasks into one row when all annotators agree.'}
                </span>
              </span>
            </label>
          )}
          <button
            onClick={() => handleExport('geojson')}
            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-neutral-100 transition-colors text-neutral-900 ${showMergeToggle ? '' : 'rounded-t-lg'}`}
            type="button"
          >
            <div className="font-medium">GeoJSON</div>
            <div className="text-xs text-neutral-500">FeatureCollection (.geojson)</div>
          </button>
          <button
            onClick={() => handleExport('csv')}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-neutral-100 transition-colors text-neutral-900 border-t border-neutral-200 rounded-b-lg"
            type="button"
          >
            <div className="font-medium">CSV</div>
            <div className="text-xs text-neutral-500">Tabular export (.csv)</div>
          </button>
        </div>
      </Dropdown>
    </div>
  );
};
