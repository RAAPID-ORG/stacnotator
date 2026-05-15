import { useState } from 'react';
import type { CampaignUserOut } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';

interface ReviewerAssignmentModalProps {
  show: boolean;
  onClose: () => void;
  campaignUsers: CampaignUserOut[];
  onAssign: (pattern: AssignmentPattern) => Promise<void>;
  totalTasks: number;
}

export type AssignmentPattern =
  | {
      type: 'percentage';
      percentage: number;
      reviewersPerTask: number;
      reviewerIds: string[];
    }
  | {
      type: 'fixed';
      numTasks: number;
      reviewersPerTask: number;
      reviewerIds: string[];
    };

export function ReviewerAssignmentModal({
  show,
  onClose,
  campaignUsers,
  onAssign,
  totalTasks,
}: ReviewerAssignmentModalProps) {
  const [activeTab, setActiveTab] = useState<'percentage' | 'fixed'>('percentage');
  const [percentage, setPercentage] = useState(10);
  const [numTasks, setNumTasks] = useState(10);
  const [reviewersPerTask, setReviewersPerTask] = useState(2);
  const [selectedReviewers, setSelectedReviewers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  if (!show) return null;

  const toggleReviewer = (userId: string) => {
    setSelectedReviewers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSelectAllReviewers = () => {
    if (selectedReviewers.length === campaignUsers.length) {
      setSelectedReviewers([]);
    } else {
      setSelectedReviewers(campaignUsers.map((u) => u.user.id));
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      if (activeTab === 'percentage') {
        await onAssign({
          type: 'percentage',
          percentage,
          reviewersPerTask,
          reviewerIds: selectedReviewers,
        });
      } else {
        await onAssign({
          type: 'fixed',
          numTasks,
          reviewersPerTask,
          reviewerIds: selectedReviewers,
        });
      }
      onClose();
    } catch (error) {
      handleError(error, 'Failed to assign reviewers');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = selectedReviewers.length >= reviewersPerTask && reviewersPerTask > 0;
  const tasksAffectedPercentage = Math.max(1, Math.floor((totalTasks * percentage) / 100));

  return (
    <div className="fixed inset-0 bg-neutral-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-neutral-300">
          <h2 className="text-xl font-semibold text-neutral-900">Assign Reviewers to Tasks</h2>
          <p className="text-sm text-neutral-500 mt-1">
            Quality assurance: Assign multiple reviewers to tasks
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-4">
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Assignment Pattern
            </label>
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => setActiveTab('percentage')}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  activeTab === 'percentage'
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                Percentage-Based
              </button>
              <button
                onClick={() => setActiveTab('fixed')}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  activeTab === 'fixed'
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                Fixed Number
              </button>
            </div>
          </div>

          {activeTab === 'percentage' && (
            <div className="mb-4 p-4 bg-neutral-50 rounded-lg">
              <p className="text-sm text-neutral-600 mb-3">
                Assign reviewers to a percentage of tasks. Tasks will be randomly selected.
              </p>

              <div className="mb-3">
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Percentage of tasks: {percentage}%
                </label>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={percentage}
                  onChange={(e) => setPercentage(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-sm text-neutral-500 mt-1">
                  ≈ {tasksAffectedPercentage} tasks will be reviewed
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Reviewers per task:
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={reviewersPerTask}
                  onChange={(e) => setReviewersPerTask(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg"
                />
              </div>
            </div>
          )}

          {activeTab === 'fixed' && (
            <div className="mb-4 p-4 bg-neutral-50 rounded-lg">
              <p className="text-sm text-neutral-600 mb-3">
                Assign reviewers to a fixed number of tasks. Tasks will be randomly selected.
              </p>

              <div className="mb-3">
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Number of tasks to review:
                </label>
                <input
                  type="number"
                  min="1"
                  max={totalTasks}
                  value={numTasks}
                  onChange={(e) => setNumTasks(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg"
                />
                <div className="text-sm text-neutral-500 mt-1">
                  Total tasks available: {totalTasks}
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Reviewers per task:
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={reviewersPerTask}
                  onChange={(e) => setReviewersPerTask(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg"
                />
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Select Reviewers (need at least {reviewersPerTask}):
            </label>
            <button
              onClick={handleSelectAllReviewers}
              className="text-sm text-brand-700 hover:text-brand-600 mb-3"
            >
              {selectedReviewers.length === campaignUsers.length ? 'Deselect All' : 'Select All'}
            </button>

            <div className="space-y-2 max-h-64 overflow-y-auto border border-neutral-300 rounded-lg p-3">
              {campaignUsers.map((cu) => (
                <label
                  key={cu.user.id}
                  className="flex items-center p-3 bg-neutral-50 rounded-lg cursor-pointer hover:bg-neutral-100"
                >
                  <input
                    type="checkbox"
                    checked={selectedReviewers.includes(cu.user.id)}
                    onChange={() => toggleReviewer(cu.user.id)}
                    className="mr-3"
                  />
                  <div>
                    <div className="font-medium text-neutral-900">{cu.user.display_name}</div>
                    <div className="text-sm text-neutral-500">{cu.user.email}</div>
                    {cu.is_admin && (
                      <span className="text-xs text-brand-700 font-semibold">Admin</span>
                    )}
                    {cu.is_authorative_reviewer && (
                      <span className="text-xs text-purple-500 font-semibold ml-2">
                        Authoritative Reviewer
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>
            <div className="text-sm text-neutral-600 mt-2">
              Selected: {selectedReviewers.length} reviewers
            </div>
          </div>

          {selectedReviewers.length > 0 && canSubmit && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Preview:</strong> Will assign {reviewersPerTask} reviewers to{' '}
                {activeTab === 'percentage' ? tasksAffectedPercentage : numTasks} tasks
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-neutral-300 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 border border-neutral-300 rounded-lg text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || loading}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {loading
              ? 'Assigning...'
              : `Assign to ${activeTab === 'percentage' ? tasksAffectedPercentage : numTasks} Tasks`}
          </button>
        </div>
      </div>
    </div>
  );
}
