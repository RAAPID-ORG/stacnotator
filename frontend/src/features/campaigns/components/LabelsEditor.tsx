import { useRef, useCallback } from 'react';
import type { LabelBase } from '~/api/client';
import { Input, Select } from '~/shared/ui/forms';

const GEOMETRY_TYPES = [
  { value: 'point', label: '● Point' },
  { value: 'polygon', label: '▰ Polygon' },
  { value: 'line', label: '━ Line' },
] as const;

interface LabelsEditorProps {
  value: LabelBase[];
  onChange: (labels: LabelBase[]) => void;
  readOnly?: boolean;
  /** When true (open mode), show geometry type selector per label */
  showGeometryType?: boolean;
  /** Hide the per-row delete button. Used post-creation where removing a label
   *  would orphan existing annotations referencing it. */
  disableDelete?: boolean;
}

export const LabelsEditor = ({
  value,
  onChange,
  readOnly = false,
  showGeometryType = false,
  disableDelete = false,
}: LabelsEditorProps) => {
  const inputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const addLabel = useCallback(() => {
    const nextId = value.length === 0 ? 1 : Math.max(...value.map((l) => l.id)) + 1;
    const newLabel: LabelBase = { id: nextId, name: '' };
    if (showGeometryType) {
      newLabel.geometry_type = 'polygon';
    }
    onChange([...value, newLabel]);

    // Focus the new input after React re-renders
    requestAnimationFrame(() => {
      inputRefs.current.get(nextId)?.focus();
    });
  }, [value, onChange, showGeometryType]);

  const updateLabel = (id: number, name: string) => {
    onChange(value.map((l) => (l.id === id ? { ...l, name } : l)));
  };

  // The wand only draws polygons, so switching a label away from them drops it.
  const updateGeometryType = (id: number, geometry_type: 'point' | 'polygon' | 'line') => {
    onChange(
      value.map((l) =>
        l.id === id
          ? {
              ...l,
              geometry_type,
              ...(geometry_type !== 'polygon' && { auto_segment: false, segment_prompt: null }),
            }
          : l
      )
    );
  };

  const updateWand = (id: number, patch: Pick<LabelBase, 'auto_segment' | 'segment_prompt'>) => {
    onChange(value.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const removeLabel = (id: number) => {
    onChange(value.filter((l) => l.id !== id));
  };

  return (
    <div className="space-y-2">
      {value.map((label) => (
        <div key={label.id} className="space-y-1.5">
          <div className="flex gap-2 items-center">
            <span className="text-xs text-neutral-500 w-8">{label.id}</span>

            <div className="flex-1">
              <Input
                type="text"
                value={label.name}
                placeholder="Class name"
                ref={(el) => {
                  if (el) inputRefs.current.set(label.id, el);
                  else inputRefs.current.delete(label.id);
                }}
                onChange={(e) => updateLabel(label.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addLabel();
                  }
                }}
                disabled={readOnly}
              />
            </div>

            {showGeometryType && (
              <div className="w-36">
                <Select
                  value={label.geometry_type || 'polygon'}
                  onChange={(e) =>
                    updateGeometryType(label.id, e.target.value as 'point' | 'polygon' | 'line')
                  }
                  disabled={readOnly}
                >
                  {GEOMETRY_TYPES.map((gt) => (
                    <option key={gt.value} value={gt.value}>
                      {gt.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {(label.geometry_type ?? 'polygon') === 'polygon' && (
              <button
                type="button"
                onClick={() =>
                  updateWand(label.id, {
                    auto_segment: !label.auto_segment,
                    segment_prompt: label.auto_segment ? null : label.segment_prompt,
                  })
                }
                disabled={readOnly}
                aria-pressed={!!label.auto_segment}
                title="Offer the magic wand for this class: a box drawn on the map is outlined automatically"
                className={`text-xs px-2 py-1.5 rounded border transition-colors cursor-pointer disabled:cursor-default ${
                  label.auto_segment
                    ? 'bg-brand-50 text-brand-700 border-brand-600'
                    : 'bg-white text-neutral-500 border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                Magic wand
              </button>
            )}

            {!readOnly && !disableDelete && (
              <button
                onClick={() => removeLabel(label.id)}
                className="text-sm text-neutral-400 hover:text-red-600 transition-colors px-1"
                type="button"
                aria-label="Remove label"
              >
                ✕
              </button>
            )}
          </div>
          {label.auto_segment && (
            <div className="pl-10">
              <Input
                type="text"
                value={label.segment_prompt ?? ''}
                placeholder="What to look for, e.g. building (optional)"
                aria-label={`Magic wand prompt for ${label.name || 'this class'}`}
                maxLength={200}
                onChange={(e) => updateWand(label.id, { segment_prompt: e.target.value })}
                disabled={readOnly}
              />
              <p className="mt-1 text-[11px] text-neutral-500">
                With a prompt, one box can outline every match inside it instead of one object.
                Separate alternatives with commas.
              </p>
            </div>
          )}
        </div>
      ))}

      {!readOnly && (
        <button
          onClick={addLabel}
          className="text-sm text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          type="button"
        >
          + Add class
        </button>
      )}
    </div>
  );
};
