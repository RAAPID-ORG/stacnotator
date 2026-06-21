import { useState } from 'react';
import {
  ingestAnnotationsFromGeojson,
  type LabelBase,
  type BodyIngestAnnotationsFromGeojson,
} from '~/api/client';
import { fileUploadBody } from '~/shared/utils/fileUploadBody';

interface ImportFeaturesSectionProps {
  campaignId: number;
  labels: LabelBase[];
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export const ImportFeaturesSection: React.FC<ImportFeaturesSectionProps> = ({
  campaignId,
  labels,
  onSuccess,
  onError,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    if (selected) {
      const name = selected.name.toLowerCase();
      if (!name.endsWith('.geojson') && !name.endsWith('.json')) {
        onError('Please upload a .geojson or .json file');
        return;
      }
    }
    setFile(selected);
  };

  const handleUpload = async () => {
    if (!file || !confirmed) return;
    try {
      setUploading(true);
      const { data, error } = await ingestAnnotationsFromGeojson({
        path: { campaign_id: campaignId },
        body: fileUploadBody<BodyIngestAnnotationsFromGeojson>({ file }),
      });

      if (error) {
        const detail = (error as { detail?: string })?.detail;
        throw new Error(detail || 'Failed to import features');
      }

      const count = (data as { num_annotations_created?: number })?.num_annotations_created ?? 0;
      onSuccess(`${count} feature(s) imported successfully`);
      setFile(null);
      setConfirmed(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to import features');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <h3 className="text-md font-semibold text-neutral-900 mb-3">Import Existing Features</h3>
      <p className="text-sm text-neutral-500 mb-4">
        Upload a GeoJSON file of existing features. Each feature must carry a{' '}
        <code className="text-xs">stacnotator_label_id</code> property whose value is one of this
        campaign's label ids (listed below). The import is rejected if any feature is missing a
        label or uses a label id that does not belong to this campaign.
      </p>

      <div className="space-y-4">
        {/* Campaign label reference */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            Campaign label ids
          </label>
          {labels.length === 0 ? (
            <p className="text-sm text-neutral-500">This campaign has no labels defined.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {labels.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-neutral-300 bg-neutral-50 text-xs text-neutral-700"
                >
                  <span className="font-semibold">{label.id}</span>
                  <span className="text-neutral-500">{label.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* File input */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">GeoJSON file</label>
          <input
            type="file"
            accept=".geojson,.json"
            onChange={handleFileChange}
            disabled={uploading}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg disabled:bg-neutral-50 disabled:cursor-not-allowed text-sm"
          />
          {file && (
            <p className="text-xs text-neutral-500 mt-1">
              Selected: {file.name} ({Math.round(file.size / 1024)} KB)
            </p>
          )}
        </div>

        {/* Acknowledgement */}
        <label className="flex items-start cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={uploading}
            className="mt-0.5 mr-3"
          />
          <span className="text-sm text-neutral-700">
            I confirm the label ids in my file match the label ids of this campaign.
          </span>
        </label>

        {/* Upload button */}
        <button
          onClick={handleUpload}
          disabled={!file || !confirmed || uploading}
          className="w-full px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {uploading && (
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
          )}
          {uploading ? 'Importing...' : 'Import Features'}
        </button>
      </div>
    </div>
  );
};
