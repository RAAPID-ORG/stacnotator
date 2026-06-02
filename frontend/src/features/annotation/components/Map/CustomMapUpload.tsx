import { useState, useRef } from 'react';
import { VizConfigPanel } from '~/features/campaigns/components/imagery/VizConfigPanel';
import type { VizParams } from '~/features/campaigns/components/imagery/types';
import type { AssetInfo } from '~/features/campaigns/components/imagery/collectionPresets';
import { fromBlob } from 'geotiff';
import { uploadFile } from '~/api/customMaps';
import { requestCustomMapUpload, createCustomMap } from '~/api/client';
import { authManager } from '~/features/auth';

interface CustomMapUploadProps {
  campaignId: number;
  onClose: () => void;
  onUploaded: () => void;
}

function bandAssets(count: number): Record<string, AssetInfo> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      String(i + 1),
      { title: `Band ${i + 1}`, type: 'image/tiff', roles: ['data'] },
    ])
  );
}

function defaultViz(bandCount: number): VizParams {
  if (bandCount >= 3) return { assets: ['1', '2', '3'], assetAsBand: true, rescale: '0,255' };
  return { assets: ['1'], assetAsBand: true, rescale: '0,255' };
}

export function CustomMapUpload({ campaignId, onClose, onUploaded }: CustomMapUploadProps) {
  const [name, setName] = useState('');
  const [vizParams, setVizParams] = useState<VizParams>(defaultViz(3));
  const [availableAssets, setAvailableAssets] = useState<Record<string, AssetInfo>>(bandAssets(3));
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (selected: File | undefined) => {
    if (!selected) return;
    setFile(selected);

    let bands = 1;
    try {
      const tiff = await fromBlob(selected);
      bands = (await tiff.getImage()).getSamplesPerPixel();
    } catch {
      // SamplesPerPixel absent or unparseable - default to 1
    }
    setAvailableAssets(bandAssets(bands));
    setVizParams(defaultViz(bands));
  };

  const handleSubmit = async () => {
    if (!name.trim() || !file) return;
    setError(null);
    setProgress(0);

    try {
      const { data: presign, error: presignErr } = await requestCustomMapUpload({
        path: { campaign_id: campaignId },
      });
      if (presignErr || !presign) throw new Error('Failed to request upload URL');

      await uploadFile(
        presign.upload_url,
        presign.method,
        file,
        () => authManager.getIdToken(),
        setProgress
      );

      const storedViz = {
        assets: vizParams.assets,
        assetAsBand: vizParams.assetAsBand,
        rescale: vizParams.rescale,
        ...(vizParams.colormapName && { colormap_name: vizParams.colormapName }),
        ...(vizParams.colorFormula && { color_formula: vizParams.colorFormula }),
        ...(vizParams.nodata !== undefined && { nodata: vizParams.nodata }),
      };

      const { error: createErr } = await createCustomMap({
        path: { campaign_id: campaignId },
        body: { name: name.trim(), key: presign.key, viz_params: storedViz },
      });
      if (createErr) {
        const detail = (createErr as { detail?: string })?.detail;
        throw new Error(detail ?? 'Failed to create custom map record');
      }
      onUploaded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress(null);
    }
  };

  const isUploading = progress !== null;
  const canSubmit = name.trim().length > 0 && file !== null && !isUploading;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
          <span className="text-sm font-semibold text-neutral-800">Upload custom map</span>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 transition-colors text-lg leading-none"
            disabled={isUploading}
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My custom raster"
              className="w-full text-sm border border-neutral-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
              disabled={isUploading}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">File</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-xs px-3 py-1.5 border border-neutral-300 rounded-md hover:bg-neutral-50 transition-colors"
                disabled={isUploading}
              >
                {file ? 'Change file' : 'Choose file…'}
              </button>
              {file && (
                <span className="text-xs text-neutral-500 truncate max-w-[200px]">{file.name}</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".tif,.tiff"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0])}
            />
          </div>

          {file && (
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                Visualization
              </label>
              <div className="border border-neutral-200 rounded-md p-3">
                <VizConfigPanel
                  collectionId="custom-map"
                  availableAssets={availableAssets}
                  vizParams={vizParams}
                  onChange={setVizParams}
                  showCompositing={false}
                />
              </div>
            </div>
          )}

          {isUploading && (
            <div>
              <div className="text-xs text-neutral-500 mb-1">Uploading… {progress}%</div>
              <div className="w-full bg-neutral-200 rounded-full h-1.5">
                <div
                  className="bg-brand-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-neutral-200">
          <button
            onClick={onClose}
            className="text-xs px-4 py-1.5 text-neutral-600 hover:bg-neutral-100 rounded-md transition-colors"
            disabled={isUploading}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="text-xs px-4 py-1.5 bg-brand-500 text-white rounded-md hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
