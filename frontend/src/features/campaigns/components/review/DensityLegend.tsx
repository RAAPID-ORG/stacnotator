import type { DensityKey } from './densityMap';

export interface DensityLegendEntry<K extends DensityKey> {
  key: K;
  name: string;
  color: string;
  count: number;
}

/** Campaign-wide totals per category, each one a switch for its cells on the map. */
export const DensityLegend = <K extends DensityKey>({
  entries,
  hidden,
  onToggle,
}: {
  entries: DensityLegendEntry<K>[];
  hidden: ReadonlySet<K>;
  onToggle: (key: K) => void;
}) => (
  <div className="flex flex-wrap gap-2 mb-3 text-sm">
    {entries.map(({ key, name, color, count }) => {
      const off = hidden.has(key);
      return (
        <button
          key={key}
          type="button"
          onClick={() => onToggle(key)}
          aria-pressed={!off}
          className={`flex items-center gap-2 rounded-full border px-3 py-1 transition-colors ${
            off
              ? 'border-neutral-200 text-neutral-400'
              : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
          }`}
          title={off ? `Show ${name}` : `Hide ${name}`}
        >
          <span
            className="w-3.5 h-3.5 rounded-full border-2 border-white"
            style={{
              backgroundColor: color,
              opacity: off ? 0.3 : 1,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.1)',
            }}
          />
          <span className="capitalize">
            {name} ({count.toLocaleString()})
          </span>
        </button>
      );
    })}
  </div>
);
