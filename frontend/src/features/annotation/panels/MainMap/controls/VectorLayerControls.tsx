import type { ImageryCatalog } from '../../../campaign/imagery';
import { useImageryStore } from '../../../stores/imagery';
import { HeaderSelect } from '../../../components/HeaderSelect';

const VectorIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 20 20"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M4 4l5 2 6-3 1 11-6 3-5-2-1-11z" />
  </svg>
);

export function VectorLayerControls({
  catalog,
  toggleTitle,
}: {
  catalog: ImageryCatalog;
  toggleTitle: string;
}) {
  const vector = useImageryStore((s) => s.vector);
  const vectorAction = useImageryStore((s) => s.vectorAction);

  const layers = [...catalog.vectorLayers.values()];
  if (layers.length === 0) return null;
  const active = layers.find((l) => l.id === vector.id);

  return (
    <div className="flex items-center gap-1" data-testid="vector-layer-controls">
      <div className="mx-0.5 h-3 w-px bg-neutral-200" />
      <HeaderSelect
        icon={
          active ? (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10"
              style={{ backgroundColor: active.color }}
            />
          ) : (
            <VectorIcon className="opacity-40" />
          )
        }
        value={vector.id ?? ''}
        options={[
          { value: '', label: 'No vector layer' },
          ...layers.map((l) => ({ value: l.id, label: l.name })),
        ]}
        onChange={(v: string | number) => {
          if (v === '') vectorAction(layers, 'deselect');
          else
            vectorAction(
              layers.filter((l) => l.id === Number(v)),
              'cycle'
            );
        }}
        title="Select vector layer"
      />
      {active && (
        <button
          type="button"
          data-testid="vector-layer-toggle"
          aria-pressed={vector.visible}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => vectorAction(layers, 'toggle')}
          title={toggleTitle}
          className={`flex h-6 w-6 items-center justify-center rounded-md cursor-pointer ${vector.visible ? 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700' : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500'}`}
        >
          <VectorIcon />
        </button>
      )}
    </div>
  );
}
