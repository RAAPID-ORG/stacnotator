import { useEffect } from 'react';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { FadeIn } from '~/shared/ui/motion';

export const OrganizationPage = () => {
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);

  useEffect(() => {
    setBreadcrumbs([{ label: 'Organization' }]);
  }, [setBreadcrumbs]);

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Organization</h1>
            <p className="page-subtitle">Organization details coming up.</p>
          </div>
        </header>
      </FadeIn>
    </div>
  );
};
