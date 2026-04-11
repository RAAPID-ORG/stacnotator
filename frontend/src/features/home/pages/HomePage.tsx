import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLayoutStore } from 'src/features/layout/layout.store';
import {
  IconStac,
  IconDocument,
  IconClock,
  IconWarning,
  IconPlay,
  IconPlus,
} from '~/shared/ui/Icons';

export const HomePage = () => {
  const navigate = useNavigate();
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

  useEffect(() => {
    setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  return (
    <div className="flex-1 overflow-auto bg-neutral-50/40">
      {/* Early access banner - persistent, full-width, visible above the fold */}
      <div className="border-b border-amber-300 bg-amber-100">
        <div className="px-10 py-3 flex gap-3 items-start">
          <div className="shrink-0 w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center mt-0.5">
            <IconWarning className="w-3.5 h-3.5 text-white" />
          </div>
          <p className="text-[13px] text-amber-900 leading-relaxed">
            <strong className="font-semibold">Early Access</strong> - STACNotator is under active
            development. Features may change and results should be independently verified. No
            warranty or liability is provided regarding the correctness or completeness of any
            outputs. Please report bugs on our{' '}
            <a
              href="https://github.com/RAAPID-ORG/stacnotator"
              target="_blank"
              rel="noreferrer"
              className="underline font-semibold hover:text-amber-950"
            >
              GitHub repository
            </a>
            .
          </p>
        </div>
      </div>

      <div className="px-10 pt-10 pb-16 space-y-12">
        {/* Hero - 50/50 text + video, fills full content width */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div className="max-w-2xl">
            <h1 className="text-[clamp(36px,3.5vw,52px)] font-bold text-neutral-900 tracking-tight leading-[1.05] mb-5">
              Annotate Earth,
              <br />
              <span className="text-brand-600">one pixel at a time.</span>
            </h1>
            <p className="text-[17px] text-neutral-600 leading-relaxed mb-7">
              STACNotator is a collaborative annotation platform for satellite and aerial imagery.
              Build campaigns on top of public STAC catalogs, label features with your team, and
              streamline review workflows with built-in QA.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate('/campaigns')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors cursor-pointer shadow-sm"
              >
                <IconDocument className="w-4 h-4" />
                Browse campaigns
              </button>
              <button
                onClick={() => navigate('/campaigns/new')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white border border-neutral-200 text-neutral-700 text-sm font-medium hover:border-brand-400 hover:text-brand-700 transition-colors cursor-pointer"
              >
                <IconPlus className="w-4 h-4" />
                New campaign
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 overflow-hidden shadow-sm bg-white">
            <div className="bg-neutral-900 aspect-video flex items-center justify-center relative group cursor-pointer">
              <div className="absolute inset-0 bg-gradient-to-br from-brand-600/25 via-neutral-900/60 to-neutral-900/90" />
              <div className="relative text-center px-6">
                <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center mx-auto mb-3 group-hover:bg-white/20 group-hover:scale-105 transition-all">
                  <IconPlay className="w-8 h-8 text-white" />
                </div>
                <p className="text-sm font-medium text-white/90">
                  Getting started with STACNotator
                </p>
                <p className="text-xs text-white/50 mt-1">Video tutorial coming soon</p>
              </div>
            </div>
          </div>
        </section>

        {/* Feature highlights */}
        <section>
          <div className="mb-5">
            <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-1">
              What you can do
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <FeatureCard
              icon={<IconStac className="w-5 h-5 text-brand-600" />}
              title="Any STAC catalog"
              description="Connect to Microsoft Planetary Computer or any STAC endpoint and annotate imagery directly - no downloads, no pre-processing."
            />
            <FeatureCard
              icon={<IconDocument className="w-5 h-5 text-brand-600" />}
              title="Team workflows"
              description="Collaborative campaigns with annotator and reviewer roles, built-in QA, and label validation against nearest neighbours."
            />
            <FeatureCard
              icon={<IconClock className="w-5 h-5 text-brand-600" />}
              title="Time-series context"
              description="Inspect NDVI history at any pixel with Sentinel-2 and MODIS, cloud-masked by Google Cloud Score+ and SCL."
            />
          </div>
        </section>
      </div>
    </div>
  );
};

type FeatureCardProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
};

const FeatureCard = ({ icon, title, description }: FeatureCardProps) => (
  <div className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-brand-300 hover:shadow-sm transition-all">
    <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center mb-3">
      {icon}
    </div>
    <h3 className="text-base font-semibold text-neutral-900 mb-1.5 leading-tight">{title}</h3>
    <p className="text-[13px] text-neutral-600 leading-relaxed">{description}</p>
  </div>
);

type StepProps = {
  number: number;
  title: string;
  description: string;
};

const Step = ({ number, title, description }: StepProps) => (
  <div className="relative rounded-xl border border-neutral-200 bg-white p-5">
    <div className="flex items-center gap-3 mb-2">
      <div className="shrink-0 w-8 h-8 rounded-full bg-brand-600 text-white flex items-center justify-center">
        <span className="text-sm font-semibold">{number}</span>
      </div>
      <h3 className="text-[15px] font-semibold text-neutral-900 leading-tight">{title}</h3>
    </div>
    <p className="text-[13px] text-neutral-600 leading-relaxed">{description}</p>
  </div>
);
