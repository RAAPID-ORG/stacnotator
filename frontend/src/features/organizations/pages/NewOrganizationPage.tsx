import { useEffect } from 'react';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { FadeIn } from '~/shared/ui/motion';

export const NewOrganizationPage = () => {
  const setBreadcrumbs = useLayoutStore((s) => s.setBreadcrumbs);

  useEffect(() => {
    setBreadcrumbs([{ label: 'New organization' }]);
  }, [setBreadcrumbs]);

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">New organization</h1>
            <p className="page-subtitle">Organization creation coming up.</p>
          </div>
        </header>
      </FadeIn>
    </div>
  );
};
