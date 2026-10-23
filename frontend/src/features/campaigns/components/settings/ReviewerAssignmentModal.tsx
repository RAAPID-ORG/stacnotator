import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { ProjectUserOut } from '~/api/client';
import { handleError } from '~/shared/utils/errorHandler';

interface ReviewerAssignmentModalProps {
  show: boolean;
  onClose: () => void;
  projectUsers: ProjectUserOut[];
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
  projectUsers,
  onAssign,
  totalTasks,
}: ReviewerAssignmentModalProps) {
  const { t } = useTranslation(['campaigns', 'common']);
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
    if (selectedReviewers.length === projectUsers.length) {
      setSelectedReviewers([]);
    } else {
      setSelectedReviewers(projectUsers.map((u) => u.user.id));
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
      handleError(error, t('reviewerAssign.failed'));
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
          <h2 className="text-xl font-semibold text-neutral-900">{t('reviewerAssign.title')}</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-4">
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              {t('reviewerAssign.pattern')}
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
                {t('reviewerAssign.percentageBased')}
              </button>
              <button
                onClick={() => setActiveTab('fixed')}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  activeTab === 'fixed'
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                {t('reviewerAssign.fixedNumber')}
              </button>
            </div>
          </div>

          {activeTab === 'percentage' && (
            <div className="mb-4 p-4 bg-neutral-50 rounded-lg">
              <p className="text-sm text-neutral-600 mb-3">
                <Trans
                  t={t}
                  i18nKey="reviewerAssign.percentageHelp"
                  values={{ count: reviewersPerTask }}
                  components={{ strong: <strong /> }}
                />
              </p>

              <div className="mb-3">
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  {t('reviewerAssign.percentageOfTasks', { percentage })}
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
                  {t('reviewerAssign.approxReviewed', { count: tasksAffectedPercentage })}
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  {t('reviewerAssign.reviewersPerTask')}
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
                <Trans
                  t={t}
                  i18nKey="reviewerAssign.fixedHelp"
                  values={{ count: reviewersPerTask }}
                  components={{ strong: <strong /> }}
                />
              </p>

              <div className="mb-3">
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  {t('reviewerAssign.numTasks')}
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
                  {t('reviewerAssign.totalAvailable', { count: totalTasks })}
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  {t('reviewerAssign.reviewersPerTask')}
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
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              {t('reviewerAssign.pool')}
            </label>
            <p className="text-xs text-neutral-500 mb-2">
              <Trans
                t={t}
                i18nKey="reviewerAssign.poolHelp"
                values={{ count: reviewersPerTask }}
                components={{ strong: <strong /> }}
              />
            </p>
            <button
              onClick={handleSelectAllReviewers}
              className="text-sm text-brand-700 hover:text-brand-600 mb-3"
            >
              {selectedReviewers.length === projectUsers.length
                ? t('assignAll.deselectAll')
                : t('assignAll.selectAll')}
            </button>

            <div className="space-y-2 max-h-64 overflow-y-auto border border-neutral-300 rounded-lg p-3">
              {projectUsers.map((cu) => (
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
                    {cu.user.email && (
                      <div className="text-sm text-neutral-500">{cu.user.email}</div>
                    )}
                    {cu.is_admin && (
                      <span className="text-xs text-brand-700 font-semibold">
                        {t('assignAll.admin')}
                      </span>
                    )}
                    {cu.is_authoritative_reviewer && (
                      <span className="text-xs text-purple-500 font-semibold ml-2">
                        {t('assignAll.authoritativeReviewer')}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>
            <div className="text-sm text-neutral-600 mt-2">
              {t('reviewerAssign.selected', { count: selectedReviewers.length })}
            </div>
          </div>

          {selectedReviewers.length > 0 && canSubmit && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <Trans
                  t={t}
                  i18nKey="reviewerAssign.preview"
                  values={{
                    reviewers: reviewersPerTask,
                    pool: selectedReviewers.length,
                    count: activeTab === 'percentage' ? tasksAffectedPercentage : numTasks,
                  }}
                  components={{ strong: <strong /> }}
                />
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
            {t('common:actions.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || loading}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {loading
              ? t('assignAll.assigning')
              : t('reviewerAssign.submit', {
                  count: activeTab === 'percentage' ? tasksAffectedPercentage : numTasks,
                })}
          </button>
        </div>
      </div>
    </div>
  );
}
