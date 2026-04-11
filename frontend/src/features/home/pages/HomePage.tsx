import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLayoutStore } from 'src/features/layout/layout.store';
import { IconPlay } from '~/shared/ui/Icons';
import { FadeIn } from '~/shared/ui/motion';

/**
 * HomePage is a quiet landing for a tool, not a marketing site. Single column,
 * generous whitespace, body-text led. The goal is "open the tool, get oriented,
 * jump in" - not "convert a visitor".
 */
export const HomePage = () => {
  const navigate = useNavigate();
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

  useEffect(() => {
    setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  return (
    <div className="flex-1 overflow-auto">
      <FadeIn className="mx-auto max-w-4xl px-8 py-16">
        {/* Identity */}
        <div className="mb-10">
          <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">STACNotator</h1>
          <p className="mt-3 text-[15px] text-neutral-600 leading-relaxed max-w-2xl">
            A collaborative annotator for satellite and aerial imagery. Build campaigns on top of
            STAC catalogs, label features with your team, and review the result with built-in QA.
          </p>
        </div>

        {/* Primary actions - quiet text-led links matching the page voice */}
        <div className="mb-12 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <button
            onClick={() => navigate('/campaigns')}
            type="button"
            className="text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          >
            Browse campaigns
          </button>
          <button
            onClick={() => navigate('/campaigns/new')}
            type="button"
            className="text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          >
            New campaign
          </button>
          <a
            href="https://github.com/RAAPID-ORG/stacnotator"
            target="_blank"
            rel="noreferrer"
            className="text-neutral-500 hover:text-neutral-800 underline underline-offset-4 decoration-neutral-300 hover:decoration-neutral-700 transition-colors"
          >
            Source on GitHub
          </a>
        </div>

        {/* Tutorial placeholder - real content area, not just a link.
            Anchors the page visually without going full marketing-hero. */}
        <section className="mb-12">
          <h2 className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-3">
            Tutorial
          </h2>
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
            <div className="aspect-video bg-neutral-900 flex items-center justify-center relative">
              <div className="absolute inset-0 bg-gradient-to-br from-brand-700/30 via-neutral-900/70 to-neutral-900/95" />
              <div className="relative text-center px-6">
                <div className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center mx-auto mb-3">
                  <IconPlay className="w-7 h-7 text-white/90" />
                </div>
                <p className="text-sm font-medium text-white/90">Getting started</p>
                <p className="text-xs text-white/50 mt-0.5">Video tutorial coming soon</p>
              </div>
            </div>
          </div>
        </section>

        {/* What you can do - quiet text list, not feature cards */}
        <section className="mb-12">
          <h2 className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-4">
            What you can do
          </h2>
          <dl className="space-y-5">
            <Feature
              title="Connect any STAC catalog"
              body="Microsoft Planetary Computer is best supported today, with experimental support for any public STAC endpoint. Imagery streams directly to the browser - no downloads, no pre-processing."
            />
            <Feature
              title="Run team campaigns"
              body="Annotator and reviewer roles, task assignment, label validation against nearest neighbours, and built-in conflict resolution when annotators disagree."
            />
            <Feature
              title="Inspect change over time"
              body="Per-pixel NDVI history from Sentinel-2 and MODIS, cloud-masked by Cloud Score+ and SCL. Customisable spectral indices on the roadmap."
            />
            <Feature
              title="Two annotation modes"
              body="Task mode for predefined points and polygons that need labeling. Open mode for free-form drawing on imagery you navigate yourself."
            />
          </dl>
        </section>

        {/* Early access notice - small, neutral, at the bottom. */}
        <div className="mt-16 pt-6 border-t border-neutral-200 text-[12px] text-neutral-500 leading-relaxed max-w-2xl">
          STACNotator is in early access and under active development. Features may change and
          results should be independently verified. Please report issues on{' '}
          <a
            href="https://github.com/RAAPID-ORG/stacnotator"
            target="_blank"
            rel="noreferrer"
            className="text-neutral-700 hover:text-neutral-900 underline underline-offset-2"
          >
            GitHub
          </a>
          .
        </div>
      </FadeIn>
    </div>
  );
};

/** Single quiet feature row. Title in neutral-900, body in neutral-600. */
const Feature = ({ title, body }: { title: string; body: string }) => (
  <div>
    <dt className="text-sm font-medium text-neutral-900 mb-0.5">{title}</dt>
    <dd className="text-[13px] text-neutral-600 leading-relaxed">{body}</dd>
  </div>
);
