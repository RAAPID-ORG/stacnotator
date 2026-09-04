import { useState } from 'react';
import { generateTasksFromSampling, type GenerateTasksResponse } from '~/api/client';
import { FileInput } from '~/shared/ui/FileInput';
import { extractErrorMessage } from '~/shared/utils/errorHandler';

// The strategy travels as a JSON string in the multipart form, so it has no
// generated type. Mirrors the discriminated union the backend validates.
type SamplingStrategy =
  | { strategy_type: 'random'; num_samples: number; seed?: number }
  | { strategy_type: 'grid'; spacing_km: number; seed?: number };

interface TaskGenerationSectionProps {
  campaignId: number;
  taskSetId: number | null;
  onTasksGenerated: (response: GenerateTasksResponse) => void;
  onError: (message: string) => void;
}

const SAMPLING_STRATEGIES = [
  {
    value: 'random',
    label: 'Random Sampling',
    description: 'Randomly sample points within the region',
  },
  {
    value: 'grid',
    label: 'Grid Sampling',
    description: 'Sample a regular grid of points, a fixed distance apart',
  },
] as const;

type StrategyType = (typeof SAMPLING_STRATEGIES)[number]['value'];

export const TaskGenerationSection: React.FC<TaskGenerationSectionProps> = ({
  campaignId,
  taskSetId,
  onTasksGenerated,
  onError,
}) => {
  const [regionFile, setRegionFile] = useState<File | null>(null);
  const [strategyType, setStrategyType] = useState<StrategyType>('random');
  const [numSamples, setNumSamples] = useState<number>(100);
  const [spacingKm, setSpacingKm] = useState<number>(5);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [useCampaignBbox, setUseCampaignBbox] = useState<boolean>(false);
  const [generating, setGenerating] = useState(false);

  const handleFileSelect = (file: File) => {
    const isValid =
      file.name.endsWith('.zip') || file.name.endsWith('.geojson') || file.name.endsWith('.json');
    if (!isValid) {
      onError('Please upload a .zip (shapefile) or .geojson file');
      return;
    }
    setRegionFile(file);
  };

  const handleGenerate = async () => {
    if (!useCampaignBbox && !regionFile) {
      onError('Please select a region file or use campaign bounding box');
      return;
    }

    if (strategyType === 'random' && numSamples < 1) {
      onError('Number of samples must be at least 1');
      return;
    }

    if (strategyType === 'grid' && spacingKm <= 0) {
      onError('Grid spacing must be greater than 0 km');
      return;
    }

    if (taskSetId === null) {
      onError('Select a task set first');
      return;
    }

    try {
      setGenerating(true);

      const strategy: SamplingStrategy =
        strategyType === 'grid'
          ? { strategy_type: 'grid', spacing_km: spacingKm, seed }
          : { strategy_type: 'random', num_samples: numSamples, seed };

      // Build the request body
      const requestBody: Record<string, unknown> = {
        strategy: JSON.stringify(strategy),
        task_set_id: taskSetId,
        use_campaign_bbox: useCampaignBbox,
      };

      // Only include region_file if not using campaign bbox
      if (!useCampaignBbox && regionFile) {
        requestBody.region_file = regionFile;
      }

      const { data, error } = await generateTasksFromSampling({
        path: { campaign_id: campaignId },
        body: requestBody as never,
      });

      if (error) {
        throw new Error(extractErrorMessage(error, 'Failed to generate tasks'));
      }

      if (data) {
        onTasksGenerated(data);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate tasks';
      onError(message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <h3 className="text-md font-semibold text-neutral-900 mb-3">Generate Tasks via Sampling</h3>
      <p className="text-sm text-neutral-500 mb-4">
        Generate annotation tasks by sampling points within a region. You can either upload a
        boundary file or use the campaign's bounding box.
      </p>

      <div className="space-y-4">
        {/* Sampling Strategy Selection */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            Sampling Strategy
          </label>
          <div className="space-y-2">
            {SAMPLING_STRATEGIES.map((strategy) => (
              <label
                key={strategy.value}
                className={`flex items-start p-3 border rounded-lg cursor-pointer transition-colors ${
                  strategyType === strategy.value
                    ? 'border-brand-600 bg-brand-50'
                    : 'border-neutral-300 hover:border-neutral-400'
                }`}
              >
                <input
                  type="radio"
                  name="samplingStrategy"
                  value={strategy.value}
                  checked={strategyType === strategy.value}
                  onChange={() => setStrategyType(strategy.value)}
                  className="mt-0.5 mr-3"
                />
                <div>
                  <span className="font-medium text-neutral-900">{strategy.label}</span>
                  <p className="text-sm text-neutral-500">{strategy.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Region Selection */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            Region Selection
          </label>

          {/* Option 1: Upload File */}
          <div
            className={`border rounded-lg p-3 mb-2 transition-colors ${
              !useCampaignBbox ? 'border-brand-600 bg-brand-50' : 'border-neutral-300'
            }`}
          >
            <label className="flex items-start cursor-pointer mb-2">
              <input
                type="radio"
                name="regionSource"
                checked={!useCampaignBbox}
                onChange={() => setUseCampaignBbox(false)}
                disabled={generating}
                className="mt-0.5 mr-3"
              />
              <div className="flex-1">
                <span className="font-medium text-neutral-900">Upload Boundary File</span>
                <p className="text-xs text-neutral-500">Shapefile (.zip) or GeoJSON (.geojson)</p>
              </div>
            </label>

            {!useCampaignBbox && (
              <div className="ml-6 mt-2">
                <FileInput
                  accept=".zip,.geojson,.json"
                  disabled={generating}
                  fileName={
                    regionFile
                      ? `${regionFile.name} (${Math.round(regionFile.size / 1024)} KB)`
                      : null
                  }
                  onSelect={handleFileSelect}
                />
              </div>
            )}
          </div>

          {/* Option 2: Use Campaign Bbox */}
          <div
            className={`border rounded-lg p-3 transition-colors ${
              useCampaignBbox ? 'border-brand-600 bg-brand-50' : 'border-neutral-300'
            }`}
          >
            <label className="flex items-start cursor-pointer">
              <input
                type="radio"
                name="regionSource"
                checked={useCampaignBbox}
                onChange={() => {
                  setUseCampaignBbox(true);
                  setRegionFile(null);
                }}
                disabled={generating}
                className="mt-0.5 mr-3"
              />
              <div>
                <span className="font-medium text-neutral-900">Use Campaign Bounding Box</span>
                <p className="text-xs text-neutral-500">
                  Sample within the campaign's defined area
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* How much to sample: a count for random, a spacing for grid */}
        {strategyType === 'grid' ? (
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Grid Spacing (km)
            </label>
            <input
              type="number"
              min="0.01"
              step="0.5"
              value={spacingKm}
              onChange={(e) => setSpacingKm(parseFloat(e.target.value) || 0)}
              disabled={generating}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-neutral-50 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-neutral-400 mt-1">
              Distance between neighbouring points. The number of tasks follows from the size of the
              region.
            </p>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Number of Samples
            </label>
            <input
              type="number"
              min="1"
              max="10000"
              value={numSamples}
              onChange={(e) => setNumSamples(parseInt(e.target.value) || 1)}
              disabled={generating}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-neutral-50 disabled:cursor-not-allowed"
            />
          </div>
        )}

        {/* Optional Seed (for reproducibility) */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            Random Seed (optional)
          </label>
          <input
            type="number"
            min="0"
            placeholder="Leave empty for random"
            value={seed ?? ''}
            onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : undefined)}
            disabled={generating}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-neutral-50 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-neutral-400 mt-1">
            {strategyType === 'grid'
              ? 'Sets where the grid starts, for reproducible sampling results'
              : 'Set a seed for reproducible sampling results'}
          </p>
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={(!useCampaignBbox && !regionFile) || generating}
          className="w-full px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {generating && (
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
          {generating ? 'Generating...' : 'Generate Tasks'}
        </button>
      </div>
    </div>
  );
};
