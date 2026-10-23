import { useState } from 'react';
import { Spinner } from '~/shared/ui/Spinner';
import { useTranslation } from 'react-i18next';
import {
  generateTasksFromSampling,
  type GenerateTasksResponse,
  type SamplingStrategy,
} from '~/api/client';
import { FileInput } from '~/shared/ui/FileInput';
import { Field, Input } from '~/shared/ui/forms';
import { extractErrorMessage } from '~/shared/utils/errorHandler';

interface TaskGenerationSectionProps {
  campaignId: number;
  taskSetId: number | null;
  onTasksGenerated: (response: GenerateTasksResponse) => void;
  onError: (message: string) => void;
}

const SAMPLING_STRATEGIES = ['random', 'grid'] as const;

type StrategyType = (typeof SAMPLING_STRATEGIES)[number];

/**
 * What a grid run actually produces. Stated in the form because these three
 * properties are what someone has to be able to defend later, when asked how
 * the sample was drawn.
 */
const GridExplainer = () => {
  const { t } = useTranslation('campaigns');
  return (
    <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 space-y-1.5">
      <p className="text-xs font-medium text-neutral-700">{t('sampling.grid.title')}</p>
      <ul className="text-xs text-neutral-500 space-y-1 list-disc pl-4">
        <li>{t('sampling.grid.spacing')}</li>
        <li>{t('sampling.grid.offset')}</li>
        <li>{t('sampling.grid.order')}</li>
      </ul>
    </div>
  );
};

export const TaskGenerationSection: React.FC<TaskGenerationSectionProps> = ({
  campaignId,
  taskSetId,
  onTasksGenerated,
  onError,
}) => {
  const { t } = useTranslation('campaigns');
  const [regionFile, setRegionFile] = useState<File | null>(null);
  const [strategyType, setStrategyType] = useState<StrategyType>('random');
  const [numSamples, setNumSamples] = useState<number>(100);
  const [spacingKm, setSpacingKm] = useState('5');
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [useCampaignBbox, setUseCampaignBbox] = useState<boolean>(false);
  const [generating, setGenerating] = useState(false);

  const spacing = parseFloat(spacingKm);
  const spacingValid = Number.isFinite(spacing) && spacing > 0;

  const handleFileSelect = (file: File) => {
    const isValid =
      file.name.endsWith('.zip') || file.name.endsWith('.geojson') || file.name.endsWith('.json');
    if (!isValid) {
      onError(t('sampling.errors.fileType'));
      return;
    }
    setRegionFile(file);
  };

  const handleGenerate = async () => {
    if (!useCampaignBbox && !regionFile) {
      onError(t('sampling.errors.noRegion'));
      return;
    }

    if (strategyType === 'random' && numSamples < 1) {
      onError(t('sampling.errors.minSamples'));
      return;
    }

    if (strategyType === 'grid' && !spacingValid) {
      onError(t('sampling.errors.spacing'));
      return;
    }

    if (seed !== undefined && (!Number.isInteger(seed) || seed < 0)) {
      onError(t('sampling.errors.seed'));
      return;
    }

    if (taskSetId === null) {
      onError(t('sampling.errors.noTaskSet'));
      return;
    }

    try {
      setGenerating(true);

      const strategy: SamplingStrategy =
        strategyType === 'grid'
          ? { strategy_type: 'grid', spacing_km: spacing, seed }
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
        throw new Error(extractErrorMessage(error, t('sampling.errors.failed')));
      }

      if (data) {
        onTasksGenerated(data);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('sampling.errors.failed');
      onError(message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <h3 className="text-md font-semibold text-neutral-900 mb-3">{t('sampling.title')}</h3>
      <p className="text-sm text-neutral-500 mb-4">{t('sampling.description')}</p>

      <div className="space-y-4">
        {/* Sampling Strategy Selection */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            {t('sampling.strategy')}
          </label>
          <div className="space-y-2">
            {SAMPLING_STRATEGIES.map((strategy) => (
              <label
                key={strategy}
                className={`flex items-start p-3 border rounded-lg cursor-pointer transition-colors ${
                  strategyType === strategy
                    ? 'border-brand-600 bg-brand-50'
                    : 'border-neutral-300 hover:border-neutral-400'
                }`}
              >
                <input
                  type="radio"
                  name="samplingStrategy"
                  value={strategy}
                  checked={strategyType === strategy}
                  onChange={() => setStrategyType(strategy)}
                  className="mt-0.5 mr-3"
                />
                <div>
                  <span className="font-medium text-neutral-900">
                    {t(`sampling.strategies.${strategy}.label`)}
                  </span>
                  <p className="text-sm text-neutral-500">
                    {t(`sampling.strategies.${strategy}.description`)}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Region Selection */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            {t('sampling.region')}
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
                <span className="font-medium text-neutral-900">{t('sampling.upload')}</span>
                <p className="text-xs text-neutral-500">{t('sampling.uploadHint')}</p>
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
                <span className="font-medium text-neutral-900">{t('sampling.useBbox')}</span>
                <p className="text-xs text-neutral-500">{t('sampling.useBboxHint')}</p>
              </div>
            </label>
          </div>
        </div>

        {/* How much to sample: a count for random, a spacing for grid */}
        {strategyType === 'grid' ? (
          <div className="space-y-3">
            <Field
              label={t('sampling.spacingLabel')}
              htmlFor="grid-spacing"
              hint={t('sampling.spacingHint')}
              error={spacingValid ? undefined : t('sampling.spacingError')}
            >
              <Input
                id="grid-spacing"
                type="number"
                min="0"
                step="any"
                value={spacingKm}
                onChange={(e) => setSpacingKm(e.target.value)}
                disabled={generating}
                invalid={!spacingValid}
              />
            </Field>
            <GridExplainer />
          </div>
        ) : (
          <Field label={t('sampling.numSamples')} htmlFor="num-samples">
            <Input
              id="num-samples"
              type="number"
              min="1"
              max="20000"
              value={numSamples}
              onChange={(e) => setNumSamples(parseInt(e.target.value) || 1)}
              disabled={generating}
            />
          </Field>
        )}

        {/* Optional Seed (for reproducibility) */}
        <Field
          label={t('sampling.seedLabel')}
          htmlFor="sampling-seed"
          hint={strategyType === 'grid' ? t('sampling.seedHintGrid') : t('sampling.seedHintRandom')}
        >
          <Input
            id="sampling-seed"
            type="number"
            min="0"
            placeholder={t('sampling.seedPlaceholder')}
            value={seed ?? ''}
            onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : undefined)}
            disabled={generating}
          />
        </Field>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={
            (!useCampaignBbox && !regionFile) ||
            (strategyType === 'grid' && !spacingValid) ||
            generating
          }
          className="w-full px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {generating && <Spinner size="xs" variant="white" />}
          {generating ? t('sampling.generating') : t('sampling.generate')}
        </button>
      </div>
    </div>
  );
};
