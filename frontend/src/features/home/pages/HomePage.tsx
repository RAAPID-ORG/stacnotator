import { useEffect } from 'react';
import { useLayoutStore } from 'src/features/layout/layout.store';

export const HomePage = () => {
  const setBreadcrumbs = useLayoutStore((state) => state.setBreadcrumbs);

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
        {/* Development disclaimer */}
        <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 p-4 flex gap-3">
          <svg
            className="flex-shrink-0 w-6 h-6 text-amber-600 mt-0.5"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          <div>
            <h3 className="font-semibold text-amber-800">Development Notice</h3>
            <p className="text-sm text-amber-700 mt-1">
              This software is under active development and is not yet fully mature. Features may
              change, and results should be independently verified. No warranty or liability is
              provided regarding the correctness or completeness of any outputs produced by this
              platform.
            </p>
          </div>
        </div>

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
