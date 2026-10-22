import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { ProjectOut } from '~/api/client';
import { IconGlobe } from '~/shared/ui/Icons';

const roleLabel = (project: ProjectOut, t: TFunction<'projects'>) => {
  if (project.is_admin) return t('row.roles.admin');
  if (project.is_member) return t('row.roles.member');
  if (!project.has_access) return t('row.roles.listed');
  return project.visibility === 'organization' ? t('row.roles.orgAccess') : t('row.roles.public');
};

export const ProjectRow = ({ project, onOpen }: { project: ProjectOut; onOpen: () => void }) => {
  const { t } = useTranslation('projects');
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
            <span title={t('row.publicProject')} aria-label={t('row.publicProject')}>
              <IconGlobe className="w-3.5 h-3.5 text-brand-500 shrink-0" />
            </span>
          )}
        </div>
        {project.description && (
          <p className="text-xs text-neutral-600 mt-0.5 truncate">{project.description}</p>
        )}
        <p className="text-[11px] text-neutral-500 mt-0.5">
          {t('row.summary', { role: roleLabel(project, t), count: campaigns })}
          {!canOpen && t('row.membershipRequired')}
        </p>
      </div>
    </li>
  );
};
