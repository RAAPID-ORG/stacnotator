import type { LabelBase } from "~/api/client";

interface LabelsEditorProps {
  value: LabelBase[];
  onChange: (labels: LabelBase[]) => void;
  readOnly?: boolean;
}

export const LabelsEditor = ({ value, onChange, readOnly = false }: LabelsEditorProps) => {
  const addLabel = () => {
    const nextId = value.length === 0 ? 1 : Math.max(...value.map((l) => l.id)) + 1;
    onChange([...value, { id: nextId, name: '' }]);
  };

  const updateLabel = (id: number, name: string) => {
    onChange(value.map((l) => (l.id === id ? { ...l, name } : l)));
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
