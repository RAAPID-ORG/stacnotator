import type { ProjectOut } from '~/api/client';
import { IconGlobe } from '~/shared/ui/Icons';

const roleLabel = (project: ProjectOut) => {
  if (project.is_admin) return 'Admin';
  if (project.is_member) return 'Member';
  if (!project.has_access) return 'Listed';
  return project.visibility === 'organization' ? 'Org access' : 'Public';
};

export const ProjectRow = ({ project, onOpen }: { project: ProjectOut; onOpen: () => void }) => {
  const canOpen = !!project.has_access;
  const campaigns = project.campaign_count ?? 0;

  return (
    <li
      data-testid="project-row"
      className={`group flex items-center gap-4 px-5 py-4 transition-colors ${
        canOpen ? 'cursor-pointer hover:bg-neutral-50/60' : 'cursor-default'
      }`}
      onClick={() => canOpen && onOpen()}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      aria-disabled={canOpen ? undefined : true}
      onKeyDown={(e) => {
        if (canOpen && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-neutral-900 truncate">{project.name}</h3>
          {project.visibility === 'public' && (
            <span title="Public project" aria-label="Public project">
              <IconGlobe className="w-3.5 h-3.5 text-brand-500 shrink-0" />
            </span>
          )}
        </div>
        {project.description && (
          <p className="text-xs text-neutral-600 mt-0.5 truncate">{project.description}</p>
        )}
        <p className="text-[11px] text-neutral-500 mt-0.5">
          {roleLabel(project)} · {campaigns} campaign{campaigns === 1 ? '' : 's'}
          {!canOpen && ' · Membership required to open'}
        </p>
      </div>
    </li>
  );
};
