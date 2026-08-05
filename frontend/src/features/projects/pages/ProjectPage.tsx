import { useEffect } from 'react';
import { projectsPath } from '~/app/routes';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { FadeIn } from '~/shared/ui/motion';

export const ProjectPage = () => {
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);

  useEffect(() => {
    setBreadcrumbs([{ label: 'Projects', path: projectsPath() }, { label: 'Project' }]);
  }, [setBreadcrumbs]);

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Project</h1>
            <p className="page-subtitle">Project details coming up.</p>
          </div>
        </header>
      </FadeIn>
    </div>
  );
};
