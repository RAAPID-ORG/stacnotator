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
}

export const LabelsEditor = ({
  value,
  onChange,
  readOnly = false,
  showGeometryType = false,
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

  const updateGeometryType = (id: number, geometry_type: 'point' | 'polygon' | 'line') => {
    onChange(value.map((l) => (l.id === id ? { ...l, geometry_type } : l)));
  };

  const removeLabel = (id: number) => {
    onChange(value.filter((l) => l.id !== id));
  };

  return (
    <div className="space-y-2">
      {value.map((label) => (
        <div key={label.id} className="flex gap-2 items-center">
          <span className="text-xs text-neutral-500 w-8">{label.id}</span>

          <div className="flex-1">
            <Input
              type="text"
              value={label.name}
              placeholder="Label name"
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

          {!readOnly && (
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
      ))}

      {!readOnly && (
        <button
          onClick={addLabel}
          className="text-sm text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer"
          type="button"
        >
          + Add label
        </button>
      )}
    </div>
  );
};
