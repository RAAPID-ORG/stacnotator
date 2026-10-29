import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { IconBook } from '~/shared/ui/Icons';
import { FadeIn } from '~/shared/ui/motion';

export const HelpPage = () => {
  const { t } = useTranslation();
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

  useEffect(() => {
    setBreadcrumbs([{ label: t('help.title') }]);
  }, [setBreadcrumbs, t]);

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="mx-auto max-w-4xl px-8 py-16">
        <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">
          {t('help.title')}
        </h1>
        <div className="mt-8 rounded-xl border border-neutral-200 bg-white px-6 py-12 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700 [&>svg]:h-6 [&>svg]:w-6">
            <IconBook />
          </div>
          <p className="text-sm font-medium text-neutral-900">{t('help.comingSoon')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500 leading-relaxed">
            {t('help.workInProgress')}
          </p>
        </div>
      </FadeIn>
    </div>
  );
};
