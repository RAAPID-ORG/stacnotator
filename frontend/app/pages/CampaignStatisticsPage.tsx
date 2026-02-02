import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getCampaignStatisticsEndpoint } from "../api/client";
import type { CampaignStatistics, UserStatistics } from "../api/client/types.gen";

export default function CampaignStatisticsPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const [statistics, setStatistics] = useState<CampaignStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) return;

    const fetchStats = async () => {
      try {
        setLoading(true);
        const response = await getCampaignStatisticsEndpoint({
          path: { campaign_id: parseInt(campaignId) },
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
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-600">Loading statistics...</div>
      </div>
    );
  }

  if (error || !statistics) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-600">{error || "No statistics available"}</div>
      </div>
    );
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 4) return "text-green-600";
    if (confidence >= 2) return "text-yellow-600";
    return "text-red-600";
  };

  const getAgreementColor = (agreement: number | null | undefined) => {
    if (agreement === null || agreement === undefined) return "text-gray-400";
    if (agreement >= 80) return "text-green-600";
    if (agreement >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getKrippendorffColor = (alpha: number | null | undefined) => {
    if (alpha === null || alpha === undefined) return "text-gray-400";
    if (alpha >= 0.8) return "text-green-600";
    if (alpha >= 0.67) return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate(`/campaigns/${campaignId}`)}
              className="text-brand-600 hover:text-brand-700 mb-2 flex items-center gap-1"
            >
              ← Back to Campaign
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Campaign Statistics</h1>
            <p className="text-gray-600 mt-1">{statistics.campaign_name}</p>
          </div>
        </div>

        {/* Overall Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500 mb-1">Total Annotations</div>
            <div className="text-3xl font-bold text-gray-900">{statistics.total_annotations}</div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500 mb-1">Total Users</div>
            <div className="text-3xl font-bold text-gray-900">{statistics.total_users}</div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500 mb-1">Total Tasks</div>
            <div className="text-3xl font-bold text-gray-900">{statistics.total_tasks}</div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500 mb-1">Multi-Annotated Tasks</div>
            <div className="text-3xl font-bold text-gray-900">{statistics.tasks_with_multiple_annotations}</div>
            <div className="text-xs text-gray-400 mt-1">
              {statistics.total_tasks > 0 
                ? `${((statistics.tasks_with_multiple_annotations / statistics.total_tasks) * 100).toFixed(1)}%`
                : "0%"
              }
            </div>
          </div>
        </div>

        {/* Inter-Annotator Agreement */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Inter-Annotator Agreement</h2>
          <div className="flex items-baseline gap-4">
            <div>
              <div className="text-sm text-gray-500 mb-1">Krippendorff's Alpha</div>
              <div className={`text-4xl font-bold ${getKrippendorffColor(statistics.krippendorff_alpha)}`}>
                {statistics.krippendorff_alpha !== null && statistics.krippendorff_alpha !== undefined
                  ? statistics.krippendorff_alpha.toFixed(3)
                  : "N/A"}
              </div>
            </div>
            <div className="text-sm text-gray-500 ml-8">
              <div>α ≥ 0.800: Excellent agreement</div>
              <div>α ≥ 0.667: Good agreement</div>
              <div>α &lt; 0.667: Poor agreement</div>
            </div>
          </div>
          {(statistics.krippendorff_alpha === null || statistics.krippendorff_alpha === undefined) && (
            <p className="text-sm text-gray-500 mt-2">
              Requires tasks with multiple annotations from different users
            </p>
          )}
        </div>

        {/* Overall Confidence */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Overall Confidence</h2>
          <div className="text-3xl font-bold text-gray-900 mb-4">
            {statistics.overall_average_confidence !== null && statistics.overall_average_confidence !== undefined
              ? statistics.overall_average_confidence.toFixed(2)
              : "N/A"}
          </div>
        </div>

        {/* Overall Label Distribution */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Overall Label Distribution</h2>
          <div className="space-y-2">
            {Object.entries(statistics.overall_label_distribution || {}).map(([label, count]) => (
              <div key={label} className="flex items-center gap-4">
                <div className="w-32 text-sm text-gray-700 truncate">{label}</div>
                <div className="flex-1 bg-gray-200 rounded-full h-6 relative">
                  <div
                    className="bg-brand-500 h-6 rounded-full flex items-center justify-end pr-2"
                    style={{
                      width: `${(count / statistics.total_annotations) * 100}%`,
                    }}
                  >
                    <span className="text-xs text-white font-medium">{count}</span>
                  </div>
                </div>
                <div className="w-16 text-sm text-gray-500 text-right">
                  {((count / statistics.total_annotations) * 100).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Per-User Statistics */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">User Statistics</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Annotations
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Avg Confidence
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Agreement %
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Label Distribution
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {statistics.user_statistics.map((user: UserStatistics) => (
                  <tr key={user.user_id} className="hover:bg-gray-50">
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {user.user_display_name || user.user_email}
                      </div>
                      {user.user_display_name && (
                        <div className="text-xs text-gray-500">{user.user_email}</div>
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {user.total_annotations}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className={`text-sm font-medium ${
                        user.average_confidence !== null && user.average_confidence !== undefined
                          ? getConfidenceColor(user.average_confidence)
                          : "text-gray-400"
                      }`}>
                        {user.average_confidence !== null && user.average_confidence !== undefined
                          ? user.average_confidence.toFixed(2)
                          : "N/A"}
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className={`text-sm font-medium ${getAgreementColor(user.agreement_with_majority)}`}>
                        {user.agreement_with_majority !== null && user.agreement_with_majority !== undefined
                          ? `${user.agreement_with_majority.toFixed(1)}%`
                          : "N/A"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2 max-w-md">
                        {Object.entries(user.label_distribution || {}).map(([label, count]) => (
                          <span
                            key={label}
                            className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-800"
                          >
                            {label}: {count}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* User Comparison - Label Distribution vs Average */}
          <div className="mt-8 border-t pt-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Label Distribution Comparison</h3>
            <p className="text-sm text-gray-500 mb-4">
              Compare each user's label distribution to the overall average
            </p>
            <div className="space-y-6">
              {statistics.user_statistics.map((user: UserStatistics) => {
                const totalUserAnnotations = user.total_annotations;
                const userLabelPercentages: Record<string, number> = {};
                const overallLabelPercentages: Record<string, number> = {};
                
                // Calculate user percentages
                Object.entries(user.label_distribution || {}).forEach(([label, count]) => {
                  userLabelPercentages[label] = (count / totalUserAnnotations) * 100;
                });
                
                // Calculate overall percentages
                Object.entries(statistics.overall_label_distribution || {}).forEach(([label, count]) => {
                  overallLabelPercentages[label] = (count / statistics.total_annotations) * 100;
                });
                
                // Get all unique labels
                const allLabels = new Set([
                  ...Object.keys(userLabelPercentages),
                  ...Object.keys(overallLabelPercentages),
                ]);
                
                return (
                  <div key={user.user_id} className="border rounded-lg p-4">
                    <div className="font-medium text-gray-900 mb-3">
                      {user.user_display_name || user.user_email}
                    </div>
                    <div className="space-y-2">
                      {Array.from(allLabels).map((label) => {
                        const userPct = userLabelPercentages[label] || 0;
                        const overallPct = overallLabelPercentages[label] || 0;
                        const diff = userPct - overallPct;
                        
                        return (
                          <div key={label} className="text-sm">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-gray-700">{label}</span>
                              <span className={`font-medium ${
                                Math.abs(diff) < 5 ? "text-gray-500" :
                                diff > 0 ? "text-brand-600" : "text-orange-600"
                              }`}>
                                {diff > 0 ? "+" : ""}{diff.toFixed(1)}%
                              </span>
                            </div>
                            <div className="flex gap-2 items-center">
                              <div className="flex-1 bg-gray-100 rounded-full h-4 relative overflow-hidden">
                                <div
                                  className="absolute bg-brand-400 h-full"
                                  style={{ width: `${overallPct}%` }}
                                />
                                <div
                                  className="absolute bg-brand-600 h-full opacity-70"
                                  style={{ width: `${userPct}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500 w-24">
                                {userPct.toFixed(1)}% vs {overallPct.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
