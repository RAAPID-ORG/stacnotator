import { useEffect } from 'react';
import { useUIStore } from '~/stores/uiStore';

export const HomePage = () => {
  const setBreadcrumbs = useUIStore((state) => state.setBreadcrumbs);

  // Empty breadcrumbs for home page
  useEffect(() => {
    setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  return (
    <div className="flex-1 overflow-auto bg-neutral-50">
      <div className="bg-gradient-to-br from-brand-500 to-brand-700 text-white">
        <div className="max-w-6xl mx-auto px-8 py-16">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-bold mb-2">Welcome to STACNotator</h1>
            <p className="text-xl text-brand-100">
              NASA Harvest's Geospatial Imagery Annotation Platform. <br />
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-12">
        <h2 className="text-2xl font-bold text-neutral-900 mb-8">Quick Start</h2>
        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <ol className="space-y-4">
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center font-semibold">
                1
              </span>
              <div>
                <h4 className="font-semibold text-neutral-900">Create a Campaign</h4>
                <p className="text-neutral-600">
                  Set up a new annotation campaign with your imagery source and labeling schema.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center font-semibold">
                2
              </span>
              <div>
                <h4 className="font-semibold text-neutral-900">Add Annotation Tasks</h4>
                <p className="text-neutral-600">
                  Define the areas of interest and time ranges to annotate.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center font-semibold">
                3
              </span>
              <div>
                <h4 className="font-semibold text-neutral-900">Start Annotating</h4>
                <p className="text-neutral-600">
                  Use the visual annotation tools to label features on the imagery.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
};
