import { useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { projectsPath } from '~/app/routes';
import { IconPlay } from '~/shared/ui/Icons';
import { FadeIn } from '~/shared/ui/motion';

export const HomePage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

  useEffect(() => {
    setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="mx-auto max-w-4xl px-8 py-16">
        <div className="mb-10">
          <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">STACNotator</h1>
          <p className="mt-3 text-[15px] text-neutral-600 leading-relaxed max-w-2xl">
            {t('home.intro')}
          </p>
        </div>

        <div className="mb-12 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <button
            onClick={() => navigate(projectsPath())}
            type="button"
            className="text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          >
            {t('home.browseProjects')}
          </button>
          <a
            href="https://github.com/RAAPID-ORG/stacnotator"
            target="_blank"
            rel="noreferrer"
            className="text-neutral-500 hover:text-neutral-800 underline underline-offset-4 decoration-neutral-300 hover:decoration-neutral-700 transition-colors"
          >
            {t('home.sourceOnGithub')}
          </a>
        </div>

        <section className="mb-12">
          <h2 className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-3">
            {t('home.tutorial')}
          </h2>
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
            <div className="aspect-video bg-neutral-900 flex items-center justify-center relative">
              <div className="absolute inset-0 bg-gradient-to-br from-brand-700/30 via-neutral-900/70 to-neutral-900/95" />
              <div className="relative text-center px-6">
                <div className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center mx-auto mb-3">
                  <IconPlay className="w-7 h-7 text-white/90" />
                </div>
                <p className="text-sm font-medium text-white/90">{t('home.gettingStarted')}</p>
                <p className="text-xs text-white/50 mt-0.5">{t('home.videoComingSoon')}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-4">
            {t('home.features')}
          </h2>
          <dl className="space-y-5">
            <Feature title={t('home.stacTitle')} body={t('home.stacBody')} />
            <Feature title={t('home.teamsTitle')} body={t('home.teamsBody')} />
            <Feature title={t('home.changeTitle')} body={t('home.changeBody')} />
            <Feature title={t('home.modesTitle')} body={t('home.modesBody')} />
            <Feature title={t('home.activeLearningTitle')} body={t('home.activeLearningBody')} />
          </dl>
        </section>

        <div className="mt-16 pt-6 border-t border-neutral-200 text-[12px] text-neutral-500 leading-relaxed max-w-2xl">
          <Trans
            t={t}
            i18nKey="home.earlyAccess"
            components={{
              link: (
                <a
                  href="https://github.com/RAAPID-ORG/stacnotator"
                  target="_blank"
                  rel="noreferrer"
                  className="text-neutral-700 hover:text-neutral-900 underline underline-offset-2"
                />
              ),
            }}
          />
        </div>
      </FadeIn>
    </div>
  );
};

const Feature = ({ title, body }: { title: string; body: string }) => (
  <div>
    <dt className="text-sm font-medium text-neutral-900 mb-0.5">{title}</dt>
    <dd className="text-[13px] text-neutral-600 leading-relaxed">{body}</dd>
  </div>
);
