import { useEffect, useState } from 'react';
import {
  getCampaignStatisticsEndpoint,
  type AnnotatorInfo,
  type CampaignStatistics,
  type PairwiseAgreement,
} from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';
import { formatDuration } from '~/shared/utils/utility';
import { IconChevronDown, IconChevronRight } from '~/shared/ui/Icons';
import { listRowCls, tableHeadRowCls } from '~/shared/ui/listRow';

interface StatisticsProps {
  campaignId: number;
  /** Restricts the figures to one task set; omitted means the whole campaign. */
  taskSetId?: number;
}

const thCls = 'px-4 py-3 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider';

const alphaColor = (alpha: number) => {
  if (alpha >= 0.8) return 'text-green-600';
  if (alpha >= 0.67) return 'text-yellow-600';
  return 'text-red-600';
};

const alphaQualifier = (alpha: number) => {
  if (alpha >= 0.8) return 'excellent agreement';
  if (alpha >= 0.67) return 'good agreement';
  return 'poor agreement';
};

const agreementBadgeCls = (agreement: number) => {
  if (agreement >= 80) return 'bg-green-100 text-green-800';
  if (agreement >= 60) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
};

const displayName = (annotator: AnnotatorInfo) =>
  annotator.user_display_name || annotator.user_email.split('@')[0];

const Statistics = ({ campaignId, taskSetId }: StatisticsProps) => {
  const [statistics, setStatistics] = useState<CampaignStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const response = await getCampaignStatisticsEndpoint({
          path: { campaign_id: campaignId },
          query: { task_set_id: taskSetId },
        });
        if (response.data) {
          setStatistics(response.data);
        }
        setError(null);
      } catch (err) {
        handleError(err, 'Failed to load statistics', { showUser: false });
        setError('Failed to load statistics');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [campaignId, taskSetId]);

  const heading = <h2 className="section-heading">Inter-annotator agreement</h2>;

  if (loading) {
    return (
      <div>
        {heading}
        <p className="section-description">Loading statistics...</p>
      </div>
    );
  }

  if (error || !statistics) {
    return (
      <div>
        {heading}
        <p className="section-description text-red-600">{error || 'No statistics available'}</p>
      </div>
    );
  }

  const annotators = statistics.annotators;
  const alpha = statistics.krippendorff_alpha;

  const agreementMap = new Map<string, PairwiseAgreement>();
  statistics.pairwise_agreements.forEach((ag) => {
    agreementMap.set(`${ag.annotator1_id}-${ag.annotator2_id}`, ag);
    agreementMap.set(`${ag.annotator2_id}-${ag.annotator1_id}`, ag);
  });

  const allLabels = Array.from(
    new Set(annotators.flatMap((ann) => Object.keys(ann.label_distribution || {})))
  ).sort();

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          {heading}
          <p className="section-description">
            {statistics.total_annotations} annotations from {annotators.length}{' '}
            {annotators.length === 1 ? 'annotator' : 'annotators'}
            {alpha !== null && alpha !== undefined && (
              <>
                {' · '}
                <span className={`font-medium ${alphaColor(alpha)}`}>α = {alpha.toFixed(3)}</span> (
                {alphaQualifier(alpha)}, based on {statistics.tasks_with_multiple_annotations}{' '}
                multi-annotated tasks)
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="flex items-center gap-1.5 px-3 h-8 rounded-full text-sm border border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 transition-colors shrink-0"
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <IconChevronDown className="w-4 h-4" />
          ) : (
            <IconChevronRight className="w-4 h-4" />
          )}
          Details
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-6">
          {annotators.length > 1 ? (
            <div>
              <h3 className="section-heading">Pairwise agreement</h3>
              <p className="section-description">
                Agreement percentage between each pair of annotators, based on their shared tasks.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className={tableHeadRowCls}>
                      <th className={thCls}>Annotator</th>
                      {annotators.map((annotator) => (
                        <th
                          key={annotator.user_id}
                          className={`${thCls} text-center`}
                          title={annotator.user_email}
                        >
                          <div className="truncate max-w-[110px]">{displayName(annotator)}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {annotators.map((rowAnnotator, index) => (
                      <tr key={rowAnnotator.user_id} className={listRowCls(index)}>
                        <td
                          className="px-4 py-3 font-medium text-neutral-700"
                          title={rowAnnotator.user_email}
                        >
                          <div className="truncate max-w-[140px]">{displayName(rowAnnotator)}</div>
                        </td>
                        {annotators.map((colAnnotator) => {
                          if (rowAnnotator.user_id === colAnnotator.user_id) {
                            return (
                              <td
                                key={colAnnotator.user_id}
                                className="px-4 py-3 text-center text-neutral-300"
                              >
                                -
                              </td>
                            );
                          }
                          const agreement = agreementMap.get(
                            `${rowAnnotator.user_id}-${colAnnotator.user_id}`
                          );
                          const pct = agreement?.agreement_percentage;
                          return (
                            <td key={colAnnotator.user_id} className="px-4 py-3 text-center">
                              {agreement && pct !== null && pct !== undefined ? (
                                <>
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${agreementBadgeCls(pct)}`}
                                  >
                                    {pct.toFixed(0)}%
                                  </span>
                                  <div className="text-xs text-neutral-400 mt-0.5">
                                    {agreement.shared_tasks} tasks
                                  </div>
                                </>
                              ) : (
                                <span className="text-neutral-400">N/A</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-neutral-500">
              Need at least 2 annotators to show pairwise agreement.
            </p>
          )}

          {Object.keys(statistics.overall_label_distribution || {}).length > 0 && (
            <div>
              <h3 className="section-heading">Label distribution</h3>
              <p className="section-description">
                How often each label was used across all annotations.
              </p>
              <div className="space-y-2">
                {Object.entries(statistics.overall_label_distribution || {})
                  .sort(([, a], [, b]) => b - a)
                  .map(([label, count]) => (
                    <div key={label} className="flex items-center gap-3">
                      <div className="w-32 text-xs text-neutral-700 truncate" title={label}>
                        {label}
                      </div>
                      <div className="flex-1 bg-neutral-100 rounded-full h-2">
                        <div
                          className="bg-brand-600 h-2 rounded-full"
                          style={{
                            width: `${Math.max((count / statistics.total_annotations) * 100, 2)}%`,
                          }}
                        />
                      </div>
                      <div className="w-24 text-xs text-neutral-500 text-right">
                        {count} ({((count / statistics.total_annotations) * 100).toFixed(1)}%)
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {annotators.length > 0 && allLabels.length > 0 && (
            <div>
              <h3 className="section-heading">Labels by annotator</h3>
              <p className="section-description">
                Comparing how each annotator uses different labels.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className={tableHeadRowCls}>
                      <th className={thCls}>Annotator</th>
                      {allLabels.map((label) => (
                        <th key={label} className={`${thCls} text-center`} title={label}>
                          <div className="truncate max-w-[110px]">{label}</div>
                        </th>
                      ))}
                      <th className={`${thCls} text-right`}>Total</th>
                      <th className={`${thCls} text-right`} title="Median active time per task">
                        Median / task
                      </th>
                      <th className={`${thCls} text-right`} title="Total active time on tasks">
                        Active time
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {annotators.map((annotator, index) => (
                      <tr key={annotator.user_id} className={listRowCls(index)}>
                        <td
                          className="px-4 py-3 font-medium text-neutral-700"
                          title={annotator.user_email}
                        >
                          <div className="truncate max-w-[140px]">{displayName(annotator)}</div>
                        </td>
                        {allLabels.map((label) => {
                          const count = annotator.label_distribution?.[label] || 0;
                          const total = annotator.total_annotations;
                          return (
                            <td key={label} className="px-4 py-3 text-center">
                              {count > 0 ? (
                                <span className="text-neutral-900">
                                  {count}{' '}
                                  <span className="text-neutral-400">
                                    ({total > 0 ? ((count / total) * 100).toFixed(0) : 0}%)
                                  </span>
                                </span>
                              ) : (
                                <span className="text-neutral-300">-</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-right font-medium text-neutral-900">
                          {annotator.total_annotations}
                        </td>
                        <td
                          className="px-4 py-3 text-right text-neutral-700"
                          title={`${annotator.timed_tasks ?? 0} timed tasks`}
                        >
                          {formatDuration(annotator.median_seconds_per_task)}
                        </td>
                        <td className="px-4 py-3 text-right text-neutral-700">
                          {formatDuration(annotator.total_active_seconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Statistics;
