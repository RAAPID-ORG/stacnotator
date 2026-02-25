import type { LabelBase } from '~/api/client';

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

export const LabelsEditor = ({ value, onChange, readOnly = false, showGeometryType = false }: LabelsEditorProps) => {
  const addLabel = () => {
    const nextId = value.length === 0 ? 1 : Math.max(...value.map((l) => l.id)) + 1;
    const newLabel: LabelBase = { id: nextId, name: '' };
    if (showGeometryType) {
      newLabel.geometry_type = 'polygon';
    }
    onChange([...value, newLabel]);
  };

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

          <input
            type="text"
            value={label.name}
            placeholder="Label name"
            onChange={(e) => updateLabel(label.id, e.target.value)}
            disabled={readOnly}
            className={`flex-1 border-b border-neutral-600 outline-none ${
              readOnly ? 'bg-neutral-100 text-neutral-700 cursor-not-allowed' : ''
            }`}
          />

          {showGeometryType && (
            <select
              value={label.geometry_type || 'polygon'}
              onChange={(e) => updateGeometryType(label.id, e.target.value as 'point' | 'polygon' | 'line')}
              disabled={readOnly}
              className={`text-xs border border-neutral-300 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-brand-500 ${
                readOnly ? 'bg-neutral-100 text-neutral-700 cursor-not-allowed' : ''
              }`}
            >
              {GEOMETRY_TYPES.map((gt) => (
                <option key={gt.value} value={gt.value}>
                  {gt.label}
                </option>
              ))}
            </select>
          )}

          {!readOnly && (
            <button
              onClick={() => removeLabel(label.id)}
              className="text-xs text-red-500 hover:text-red-700 transition-colors"
              type="button"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {!readOnly && (
        <button
          onClick={addLabel}
          className="text-sm text-neutral-700 hover:text-neutral-900 transition-colors cursor-pointer"
          type="button"
        >
          + Add label
        </button>
      )}
    </div>
  );
};
