import { useEffect } from 'react';
import { projectsPath } from '~/app/routes';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { FadeIn } from '~/shared/ui/motion';

export const NewProjectPage = () => {
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);

  useEffect(() => {
    setBreadcrumbs([{ label: 'Projects', path: projectsPath() }, { label: 'New project' }]);
  }, [setBreadcrumbs]);

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">New project</h1>
            <p className="page-subtitle">Project creation coming up.</p>
          </div>
        </header>
      </FadeIn>
    </div>
  );
};
