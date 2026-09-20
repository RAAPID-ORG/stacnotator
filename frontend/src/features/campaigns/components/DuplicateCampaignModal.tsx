import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CampaignListItemOut, type CampaignOut } from '~/api/client';
import {
  duplicateCampaignMutation,
  listProjectCampaignsQueryKey,
  listProjectsOptions,
} from '~/api/queries';
import { Modal } from '~/shared/ui/Modal';
import { Button, Field, Select } from '~/shared/ui/forms';
import { IconInfo } from '~/shared/ui/Icons';

/** Tri-state on purpose: both switches must be an explicit decision before
 *  the duplicate can run - they are the two things people forget to think
 *  about when cloning a campaign. */
type Choice = boolean | null;

const YesNoChoice = ({
  value,
  onChange,
  testId,
}: {
  value: Choice;
  onChange: (v: boolean) => void;
  testId: string;
}) => (
  <div className="flex shrink-0 gap-1" role="radiogroup" data-testid={testId}>
    {([true, false] as const).map((option) => (
      <button
        key={String(option)}
        type="button"
        role="radio"
        aria-checked={value === option}
        onClick={() => onChange(option)}
        className={`w-14 rounded-md border px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
          value === option
            ? 'border-brand-600 bg-brand-50 text-brand-800'
            : 'border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-700'
        }`}
      >
        {option ? 'Yes' : 'No'}
      </button>
    ))}
  </div>
);

const Question = ({
  title,
  children,
  ...choice
}: {
  title: string;
  children: React.ReactNode;
  value: Choice;
  onChange: (v: boolean) => void;
  testId: string;
}) => (
  <div className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 p-3">
    <div>
      <p className="text-xs font-semibold text-neutral-800">{title}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">{children}</p>
    </div>
    <YesNoChoice {...choice} />
  </div>
);

const Notice = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
    <IconInfo className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
    <p className="text-[11px] leading-snug text-amber-800">{children}</p>
  </div>
);

interface DuplicateCampaignModalProps {
  campaign: CampaignListItemOut;
  onClose: () => void;
  /** Called with the freshly created campaign after a successful duplicate. */
  onDuplicated: (created: CampaignOut) => void;
}

export const DuplicateCampaignModal = ({
  campaign,
  onClose,
  onDuplicated,
}: DuplicateCampaignModalProps) => {
  const [targetProjectId, setTargetProjectId] = useState(campaign.project_id);
  const [includeTasks, setIncludeTasks] = useState<Choice>(null);
  const [includeAnnotations, setIncludeAnnotations] = useState<Choice>(null);
  const [includeAssignments, setIncludeAssignments] = useState(true);
  const [includeAgentAssignments, setIncludeAgentAssignments] = useState(false);
  const [includeUserLayouts, setIncludeUserLayouts] = useState(true);
  const queryClient = useQueryClient();

  // Only a project you administer can receive a campaign. The current project
  // is offered without waiting for the list - being here already proves it.
  const { data: projectsData } = useQuery({
    ...listProjectsOptions(),
    meta: { errorMessage: 'Failed to load projects' },
  });
  const otherProjects = useMemo(
    () =>
      (projectsData?.items ?? [])
        .filter((project) => project.is_admin && project.id !== campaign.project_id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [projectsData, campaign.project_id]
  );

  const crossProject = targetProjectId !== campaign.project_id;

  const duplicate = useMutation({
    ...duplicateCampaignMutation(),
    meta: { errorMessage: 'Failed to duplicate campaign' },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: listProjectCampaignsQueryKey({ path: { project_id: created.project_id } }),
      });
      onDuplicated(created);
    },
  });
  const submitting = duplicate.isPending;

  const ready = includeTasks !== null && (crossProject || includeAnnotations !== null);

  const handleDuplicate = () => {
    if (!ready || submitting || includeTasks === null) return;
    duplicate.mutate({
      path: { campaign_id: campaign.id },
      body: {
        include_tasks: includeTasks,
        // Everything that names a user stays behind in another project.
        include_annotations: !crossProject && includeAnnotations === true,
        include_assignments: !crossProject && includeTasks && includeAssignments,
        include_agent_assignments:
          !crossProject && includeTasks && includeAssignments && includeAgentAssignments,
        include_user_layouts: !crossProject && includeUserLayouts,
        target_project_id: targetProjectId,
      },
    });
  };

  return (
    <Modal
      title={`Duplicate "${campaign.name}"`}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleDuplicate}
            disabled={!ready || submitting}
            title={ready ? undefined : 'Answer the questions first'}
            data-testid="confirm-duplicate-campaign"
          >
            {submitting ? 'Duplicating…' : 'Duplicate campaign'}
          </Button>
        </div>
      }
    >
      <div className="px-5 py-4 space-y-4">
        <p className="text-xs leading-relaxed text-neutral-600">
          Creates a new campaign with the same setup: imagery sources and visualizations, views and
          layouts, labels and forms, labelling policy, time series, basemaps and overlays. Adjust
          the copy afterwards in its settings.
        </p>

        <Field
          label="Copy into"
          htmlFor="duplicate-target-project"
          hint={crossProject ? 'Only projects you administer can receive a campaign.' : undefined}
        >
          <Select
            id="duplicate-target-project"
            size="sm"
            value={targetProjectId}
            onChange={(e) => setTargetProjectId(Number(e.target.value))}
            data-testid="duplicate-target-project"
          >
            <option value={campaign.project_id}>This project</option>
            {otherProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </Field>

        {crossProject && (
          <Notice>
            Annotations, task assignments and personal layouts are <strong>not</strong> copied into
            another project - the people they name need not be members there. Only the setup, and
            the task locations if you keep them, come along.
          </Notice>
        )}

        <div className="space-y-3">
          <Question
            title="Also duplicate tasks?"
            value={includeTasks}
            onChange={setIncludeTasks}
            testId="duplicate-tasks"
          >
            {crossProject
              ? 'Copies all task locations and task sets. They arrive unassigned, with no progress.'
              : 'Copies all task locations and task sets. Task progress starts fresh unless annotations are copied too.'}
          </Question>

          {!crossProject && includeTasks === true && (
            <div className="ml-4 space-y-3 border-l-2 border-neutral-100 pl-3">
              <Question
                title="Keep who each task is assigned to?"
                value={includeAssignments}
                onChange={setIncludeAssignments}
                testId="duplicate-assignments"
              >
                Copies the explicit assignments to annotators. Without them every task in the copy
                is open for anyone to pick up.
              </Question>

              {includeAssignments && (
                <Question
                  title="Including tasks labelling agents hold?"
                  value={includeAgentAssignments}
                  onChange={setIncludeAgentAssignments}
                  testId="duplicate-agent-assignments"
                >
                  An agent is registered for one campaign, so in the copy these tasks sit with
                  accounts that will never work them until you free or reassign them.
                </Question>
              )}
            </div>
          )}

          {!crossProject && (
            <>
              <Question
                title="Also duplicate annotations?"
                value={includeAnnotations}
                onChange={setIncludeAnnotations}
                testId="duplicate-annotations"
              >
                Copies every existing label with its author and timestamps into the new campaign.
              </Question>

              <Question
                title="Keep personal layouts?"
                value={includeUserLayouts}
                onChange={setIncludeUserLayouts}
                testId="duplicate-user-layouts"
              >
                Copies the canvas window arrangements individual users saved for themselves.
              </Question>
            </>
          )}
        </div>

        {!crossProject && includeAnnotations === true && includeTasks === false && (
          <Notice>
            Without tasks, only annotations that are not linked to a task (open-mode labels) are
            copied.
          </Notice>
        )}
      </div>
    </Modal>
  );
};
