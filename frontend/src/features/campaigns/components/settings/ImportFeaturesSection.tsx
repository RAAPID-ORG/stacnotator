import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ingestAnnotationsFromGeojson, type LabelBase } from '~/api/client';
import { FileInput } from '~/shared/ui/FileInput';

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
  const { t } = useTranslation('campaigns');
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = (selected: File) => {
    const name = selected.name.toLowerCase();
    if (!name.endsWith('.geojson') && !name.endsWith('.json')) {
      onError(t('importFeatures.wrongFileType'));
      return;
    }
    setFile(selected);
  };

  const handleUpload = async () => {
    if (!file || !confirmed) return;
    try {
      setUploading(true);
      const { data, error } = await ingestAnnotationsFromGeojson({
        path: { campaign_id: campaignId },
        body: { file } as never,
      });

      if (error) {
        const detail = (error as { detail?: string })?.detail;
        throw new Error(detail || t('importFeatures.failed'));
      }

      const count = (data as { num_annotations_created?: number })?.num_annotations_created ?? 0;
      onSuccess(t('importFeatures.success', { count }));
      setFile(null);
      setConfirmed(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : t('importFeatures.failed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <h3 className="text-md font-semibold text-neutral-900 mb-3">{t('importFeatures.title')}</h3>
      <p className="text-sm text-neutral-500 mb-4">
        <Trans
          t={t}
          i18nKey="importFeatures.description"
          components={{ code: <code className="text-xs" /> }}
        />
      </p>

      <div className="space-y-4">
        {/* Campaign label reference */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            {t('importFeatures.labelIds')}
          </label>
          {labels.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('importFeatures.noLabels')}</p>
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
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            {t('importFeatures.fileLabel')}
          </label>
          <FileInput
            accept=".geojson,.json"
            disabled={uploading}
            fileName={file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : null}
            onSelect={handleFileSelect}
          />
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
          <span className="text-sm text-neutral-700">{t('importFeatures.confirm')}</span>
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
          {uploading ? t('importFeatures.importing') : t('importFeatures.submit')}
        </button>
      </div>
    </div>
  );
};
