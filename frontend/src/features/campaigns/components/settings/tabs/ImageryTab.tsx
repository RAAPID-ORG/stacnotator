import React from 'react';
import type { ImagerySourceOut } from '~/api/client';

interface Props {
  imagery: ImagerySourceOut[];
  setDeleteConfirm: (v: { imageryId?: number } | null) => void;
}

export const ImageryTab: React.FC<Props> = ({ imagery, setDeleteConfirm }) => {
  return (
    <div id="tab-imagery" role="tabpanel" className="space-y-3">
      <div className="bg-white rounded-lg border border-neutral-300 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4">
          Imagery Sources ({imagery.length})
        </h2>
        <p className="text-sm text-neutral-500 mb-4">
          Imagery sources are the satellite or map layers displayed during annotation. Each source
          defines a tile service with visualisation settings and one or more temporal collections.
        </p>
        <div className="space-y-4">
          {imagery.length === 0 ? (
            <p className="text-sm text-neutral-500">No imagery sources added yet.</p>
          ) : (
            imagery.map((src) => (
              <div key={src.id} className="rounded-lg border border-neutral-300 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-neutral-900">{src.name}</h4>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm({ imageryId: src.id })}
                    className="text-sm text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-neutral-500">Default Zoom:</span>{' '}
                    <span className="text-neutral-900">{src.default_zoom}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-500">Crosshair:</span>
                    <span
                      className="w-4 h-4 rounded-full border border-neutral-300 inline-block"
                      style={{ backgroundColor: `#${src.crosshair_hex6}` }}
                    />
                    <span className="text-neutral-900 font-mono text-xs">
                      #{src.crosshair_hex6}
                    </span>
                  </div>
                </div>

                {src.visualizations.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-neutral-700">Visualizations</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {src.visualizations.map((viz) => (
                        <span
                          key={viz.id}
                          className="inline-block px-2 py-0.5 bg-neutral-100 text-neutral-700 text-xs rounded"
                        >
                          {viz.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {src.collections.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-neutral-700">
                      Collections ({src.collections.length})
                    </span>
                    <div className="mt-1 space-y-2">
                      {src.collections.map((col) => (
                        <div
                          key={col.id}
                          className="text-xs text-neutral-600 bg-neutral-50 rounded p-2"
                        >
                          <span className="font-medium">{col.name}</span>
                          <span className="ml-2 text-neutral-400">
                            {col.slices.length} slice(s)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageryTab;
