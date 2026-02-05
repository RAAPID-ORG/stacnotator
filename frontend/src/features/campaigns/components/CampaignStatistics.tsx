import { useEffect, useState } from "react";
import { getCampaignStatisticsEndpoint } from "../../api/client";
import type { CampaignStatistics, AnnotatorInfo, PairwiseAgreement } from "../../api/client/types.gen";

interface CampaignStatisticsProps {
  campaignId: number;
}

export function CampaignStatisticsComponent({ campaignId }: CampaignStatisticsProps) {
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
        });
        if (response.data) {
          setStatistics(response.data);
        }
        setError(null);
      } catch (err) {
        console.error("Error fetching statistics:", err);
        setError("Failed to load statistics");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [campaignId]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div className="text-sm text-gray-500">Loading statistics...</div>
      </div>
    );
  }

  if (error || !statistics) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div className="text-sm text-red-600">{error || "No statistics available"}</div>
      </div>
    );
  }

  const getKrippendorffColor = (alpha: number | null | undefined) => {
    if (alpha === null || alpha === undefined) return "text-gray-400";
    if (alpha >= 0.8) return "text-green-600";
    if (alpha >= 0.67) return "text-yellow-600";
    return "text-red-600";
  };

  const getAgreementColor = (agreement: number | null | undefined) => {
    if (agreement === null || agreement === undefined) return "bg-gray-100 text-gray-400";
    if (agreement >= 80) return "bg-green-100 text-green-800";
    if (agreement >= 60) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  // Build agreement matrix
  const buildAgreementMatrix = () => {
    const annotators = statistics.annotators;
    const agreements = statistics.pairwise_agreements;
    
    // Create a map for quick lookup
    const agreementMap = new Map<string, PairwiseAgreement>();
    agreements.forEach(ag => {
      const key1 = `${ag.annotator1_id}-${ag.annotator2_id}`;
      const key2 = `${ag.annotator2_id}-${ag.annotator1_id}`;
      agreementMap.set(key1, ag);
      agreementMap.set(key2, ag);
    });

    return { annotators, agreementMap };
  };

  const { annotators, agreementMap } = buildAgreementMatrix();

  const getAgreementValue = (userId1: string, userId2: string) => {
    if (userId1 === userId2) return null; // Diagonal
    const key = `${userId1}-${userId2}`;
    const agreement = agreementMap.get(key);
    return agreement;
  };

  const getUserDisplayName = (annotator: AnnotatorInfo) => {
    return annotator.user_display_name || annotator.user_email.split('@')[0];
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors rounded-lg group"
        type="button"
      >
        <div className="flex items-center gap-4">
          <span className="text-lg font-semibold text-gray-900">Inter-Annotator Agreement</span>
          <div className="flex gap-4 text-sm">
            <span className="text-gray-600">
              {statistics.total_annotations} annotations
            </span>
            <span className="text-gray-600">
              {annotators.length} annotators
            </span>
            {statistics.krippendorff_alpha !== null && statistics.krippendorff_alpha !== undefined && (
              <span className={`font-medium ${getKrippendorffColor(statistics.krippendorff_alpha)}`}>
                α = {statistics.krippendorff_alpha.toFixed(3)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 group-hover:text-brand-600 transition-colors">
            {isExpanded ? "Hide details" : "Click for details"}
          </span>
          <svg
            className={`w-5 h-5 text-gray-400 group-hover:text-brand-600 transition-all ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-200">
          {/* Krippendorff's Alpha Info */}
          <div className="py-4 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Krippendorff's Alpha</h3>
            <div className="flex items-baseline gap-3">
              <div className={`text-xl font-bold ${getKrippendorffColor(statistics.krippendorff_alpha)}`}>
                {statistics.krippendorff_alpha !== null && statistics.krippendorff_alpha !== undefined
                  ? statistics.krippendorff_alpha.toFixed(3)
                  : "N/A"}
              </div>
              {statistics.krippendorff_alpha !== null && statistics.krippendorff_alpha !== undefined && (
                <div className="flex flex-col">
                  <span className={`text-sm font-medium ${getKrippendorffColor(statistics.krippendorff_alpha)}`}>
                    {statistics.krippendorff_alpha >= 0.8 ? "Excellent agreement" : statistics.krippendorff_alpha >= 0.67 ? "Good agreement" : "Poor agreement"}
                  </span>
                  <span className="text-xs text-gray-500">
                    Based on {statistics.tasks_with_multiple_annotations} multi-annotated tasks
                  </span>
                </div>
              )}
            </div>
          </div>
          

          {/* Pairwise Agreement Matrix */}
          {annotators.length > 1 && (
            <div className="py-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Pairwise Agreement Matrix</h3>
              <p className="text-xs text-gray-500 mb-3">
                Agreement percentage between each pair of annotators (based on shared tasks)
              </p>
              
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="border border-gray-300 bg-gray-50 px-2 py-1 text-left font-medium text-gray-700 sticky left-0 z-10">
                        Annotator
                      </th>
                      {annotators.map((annotator) => (
                        <th
                          key={annotator.user_id}
                          className="border border-gray-300 bg-gray-50 px-2 py-1 text-center font-medium text-gray-700 min-w-[80px]"
                          title={annotator.user_email}
                        >
                          <div className="truncate max-w-[80px]">
                            {getUserDisplayName(annotator)}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {annotators.map((rowAnnotator) => (
                      <tr key={rowAnnotator.user_id}>
                        <td className="border border-gray-300 bg-gray-50 px-2 py-1 font-medium text-gray-700 sticky left-0 z-10">
                          <div className="truncate max-w-[120px]" title={rowAnnotator.user_email}>
                            {getUserDisplayName(rowAnnotator)}
                          </div>
                        </td>
                        {annotators.map((colAnnotator) => {
                          const agreement = getAgreementValue(rowAnnotator.user_id, colAnnotator.user_id);
                          const isDiagonal = rowAnnotator.user_id === colAnnotator.user_id;
                          
                          return (
                            <td
                              key={colAnnotator.user_id}
                              className={`border border-gray-300 px-2 py-1 text-center ${
                                isDiagonal ? 'bg-gray-200' : ''
                              }`}
                            >
                              {isDiagonal ? (
                                <span className="text-gray-400">-</span>
                              ) : agreement ? (
                                <div>
                                  <div className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                    getAgreementColor(agreement.agreement_percentage)
                                  }`}>
                                    {agreement.agreement_percentage !== null && agreement.agreement_percentage !== undefined
                                      ? `${agreement.agreement_percentage.toFixed(0)}%`
                                      : "N/A"}
                                  </div>
                                  <div className="text-xs text-gray-400 mt-0.5">
                                    ({agreement.shared_tasks} tasks)
                                  </div>
                                </div>
                              ) : (
                                <span className="text-gray-400">N/A</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div className="mt-4 flex items-center gap-4 text-xs text-gray-600">
                <span className="font-medium">Agreement:</span>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 bg-green-100 border border-green-300 rounded"></div>
                  <span>≥80% (High)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 bg-yellow-100 border border-yellow-300 rounded"></div>
                  <span>60-79% (Medium)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 bg-red-100 border border-red-300 rounded"></div>
                  <span>&lt;60% (Low)</span>
                </div>
              </div>
            </div>
          )}

          {annotators.length <= 1 && (
            <div className="py-4 text-center text-sm text-gray-500">
              Need at least 2 annotators to show pairwise agreement.
            </div>
          )}

          {/* Overall Label Distribution */}
          {Object.keys(statistics.overall_label_distribution || {}).length > 0 && (
            <div className="py-4 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Overall Label Distribution</h3>
              <div className="space-y-2">
                {Object.entries(statistics.overall_label_distribution || {})
                  .sort(([, a], [, b]) => b - a)
                  .map(([label, count]) => (
                    <div key={label} className="flex items-center gap-2">
                      <div className="w-32 text-xs text-gray-700 truncate" title={label}>{label}</div>
                      <div className="flex-1 bg-gray-200 rounded-full h-3 relative">
                        <div
                          className="bg-brand-500 h-3 rounded-full flex items-center justify-end pr-2"
                          style={{
                            width: `${Math.max((count / statistics.total_annotations) * 100, 2)}%`,
                          }}
                        >
                          <span className="text-xs text-white font-medium">{count}</span>
                        </div>
                      </div>
                      <div className="w-16 text-xs text-gray-500 text-right">
                        {((count / statistics.total_annotations) * 100).toFixed(1)}%
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Per-User Label Distribution */}
          {annotators.length > 0 && Object.keys(statistics.overall_label_distribution || {}).length > 0 && (
            <div className="py-4 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Label Distribution by Annotator</h3>
              <p className="text-xs text-gray-500 mb-3">
                Comparing how each annotator uses different labels
              </p>
              
              {/* Get all unique labels */}
              {(() => {
                const allLabels = Array.from(
                  new Set(
                    annotators.flatMap((ann) => Object.keys(ann.label_distribution || {}))
                  )
                ).sort();

                return (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="border border-gray-300 px-3 py-2 text-left font-medium text-gray-700 sticky left-0 bg-gray-50 z-10">
                            Annotator
                          </th>
                          {allLabels.map((label) => (
                            <th
                              key={label}
                              className="border border-gray-300 px-3 py-2 text-center font-medium text-gray-700 min-w-[100px]"
                              title={label}
                            >
                              <div className="truncate max-w-[100px]">{label}</div>
                            </th>
                          ))}
                          <th className="border border-gray-300 px-3 py-2 text-center font-medium text-gray-700">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white">
                        {annotators.map((annotator) => {
                          const total = annotator.total_annotations;
                          return (
                            <tr key={annotator.user_id} className="hover:bg-gray-50">
                              <td className="border border-gray-300 px-3 py-2 font-medium text-gray-700 sticky left-0 bg-white z-10">
                                <div className="truncate max-w-[120px]" title={annotator.user_email}>
                                  {getUserDisplayName(annotator)}
                                </div>
                              </td>
                              {allLabels.map((label) => {
                                const count = annotator.label_distribution?.[label] || 0;
                                const percentage = total > 0 ? (count / total) * 100 : 0;
                                return (
                                  <td
                                    key={label}
                                    className="border border-gray-300 px-3 py-2 text-center"
                                  >
                                    {count > 0 ? (
                                      <div>
                                        <div className="font-medium text-gray-900">{count}</div>
                                        <div className="text-gray-500">({percentage.toFixed(0)}%)</div>
                                        {/* Mini bar */}
                                        <div className="mt-1 bg-gray-200 rounded-full h-1.5 w-full">
                                          <div
                                            className="bg-brand-500 h-1.5 rounded-full"
                                            style={{ width: `${percentage}%` }}
                                          />
                                        </div>
                                      </div>
                                    ) : (
                                      <span className="text-gray-300">-</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="border border-gray-300 px-3 py-2 text-center font-bold text-gray-900">
                                {total}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
