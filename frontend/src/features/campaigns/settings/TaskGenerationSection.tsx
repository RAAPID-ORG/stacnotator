import { useState } from 'react';
import { generateTasksFromSampling, type GenerateTasksResponse } from '~/api/client';

// Local type definition for sampling strategy configuration
interface SamplingStrategyConfig {
  strategy_type: string;
  num_samples: number;
  parameters: { seed?: number } | null;
  use_campaign_bbox: boolean;
}

interface TaskGenerationSectionProps {
  campaignId: number;
  onTasksGenerated: (response: GenerateTasksResponse) => void;
  onError: (message: string) => void;
}

const SAMPLING_STRATEGIES = [
  {
    value: 'random',
    label: 'Random Sampling',
    description: 'Randomly sample points within the region',
  },
  // Future strategies can be added here
  // { value: 'stratified_random', label: 'Stratified Random', description: 'Random sampling with stratification' },
  // { value: 'grid', label: 'Grid Sampling', description: 'Sample points on a regular grid' },
];

export const TaskGenerationSection: React.FC<TaskGenerationSectionProps> = ({
  campaignId,
  onTasksGenerated,
  onError,
}) => {
  const [regionFile, setRegionFile] = useState<File | null>(null);
  const [strategyType, setStrategyType] = useState<string>('random');
  const [numSamples, setNumSamples] = useState<number>(100);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [useCampaignBbox, setUseCampaignBbox] = useState<boolean>(false);
  const [generating, setGenerating] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      const isValid =
        file.name.endsWith('.zip') || file.name.endsWith('.geojson') || file.name.endsWith('.json');
      if (!isValid) {
        onError('Please upload a .zip (shapefile) or .geojson file');
        return;
      }
    }
    setRegionFile(file);
  };

  const handleGenerate = async () => {
    if (!useCampaignBbox && !regionFile) {
      onError('Please select a region file or use campaign bounding box');
      return;
    }

    if (numSamples < 1) {
      onError('Number of samples must be at least 1');
      return;
    }

    try {
      setGenerating(true);

      const strategy: SamplingStrategyConfig = {
        strategy_type: strategyType,
        num_samples: numSamples,
        parameters: seed !== undefined ? { seed } : null,
        use_campaign_bbox: useCampaignBbox,
      };

      // Build the request body
      const requestBody: any = {
        strategy: JSON.stringify(strategy),
      };

      // Only include region_file if not using campaign bbox
      if (!useCampaignBbox && regionFile) {
        requestBody.region_file = regionFile;
      }

      const { data, error } = await generateTasksFromSampling({
        path: { campaign_id: campaignId },
        body: requestBody,
      });

      if (error) {
        throw new Error(typeof error === 'string' ? error : 'Failed to generate tasks');
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
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-neutral-300 hover:border-neutral-400'
                }`}
              >
                <input
                  type="radio"
                  name="samplingStrategy"
                  value={strategy.value}
                  checked={strategyType === strategy.value}
                  onChange={(e) => setStrategyType(e.target.value)}
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
              !useCampaignBbox ? 'border-brand-500 bg-brand-50' : 'border-neutral-300'
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
                <input
                  type="file"
                  accept=".zip,.geojson,.json"
                  onChange={handleFileChange}
                  disabled={generating}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg disabled:bg-neutral-50 disabled:cursor-not-allowed text-sm"
                />
                {regionFile && (
                  <p className="text-xs text-neutral-500 mt-1">
                    Selected: {regionFile.name} ({Math.round(regionFile.size / 1024)} KB)
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Option 2: Use Campaign Bbox */}
          <div
            className={`border rounded-lg p-3 transition-colors ${
              useCampaignBbox ? 'border-brand-500 bg-brand-50' : 'border-neutral-300'
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

        {/* Number of Samples */}
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
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-neutral-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Optional Seed (for reproducibility) */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            Random Seed (optional)
          </label>
          <input
            type="number"
            placeholder="Leave empty for random"
            value={seed ?? ''}
            onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : undefined)}
            disabled={generating}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-neutral-50 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-neutral-400 mt-1">
            Set a seed for reproducible sampling results
          </p>
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={(!useCampaignBbox && !regionFile) || generating}
          className="w-full px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
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
