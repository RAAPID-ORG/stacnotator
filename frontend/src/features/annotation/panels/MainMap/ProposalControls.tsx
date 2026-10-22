import { useState } from 'react';
import { acceptProposals } from '../../drawing';
import { useWandStore } from '../../stores/wand';
import { stepGrowth } from '../../wand';

const buttonClass =
  'pointer-events-auto rounded-full px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer';

/**
 * Accept / discard for the wand's proposals, anchored beside them. Clicking an
 * outline on the map leaves it out of the accept; the count says how many
 * accepting would save.
 */
export function ProposalControls() {
  const proposals = useWandStore((s) => s.proposals);
  const growth = useWandStore((s) => s.growth);
  const [saving, setSaving] = useState(false);
  const accepted = proposals.filter((p) => p.accepted).length;
  if (proposals.length === 0) return null;

  const accept = async () => {
    setSaving(true);
    try {
      await acceptProposals();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="wand-proposal-controls"
      data-accepted-count={accepted}
      data-growth-index={growth?.index}
      className="flex items-center gap-1"
    >
      {growth && (
        <>
          <button
            type="button"
            data-testid="wand-shrink-btn"
            disabled={growth.index === 0}
            onClick={() => void stepGrowth(-1)}
            title="Shrink the outline ([)"
            aria-label="Shrink the outline"
            className={`${buttonClass} bg-neutral-700 hover:bg-neutral-800`}
          >
            −
          </button>
          <button
            type="button"
            data-testid="wand-grow-btn"
            disabled={growth.index >= growth.stops - 1}
            onClick={() => void stepGrowth(1)}
            title="Grow the outline (])"
            aria-label="Grow the outline"
            className={`${buttonClass} bg-neutral-700 hover:bg-neutral-800`}
          >
            +
          </button>
        </>
      )}
      <button
        type="button"
        data-testid="wand-accept-btn"
        disabled={saving || accepted === 0}
        onClick={() => void accept()}
        title="Save the outlined objects (Enter)"
        className={`${buttonClass} bg-green-600 hover:bg-green-700`}
      >
        Accept {accepted === proposals.length ? accepted : `${accepted}/${proposals.length}`}
      </button>
      <button
        type="button"
        data-testid="wand-discard-btn"
        disabled={saving}
        onClick={() => useWandStore.getState().discard()}
        title="Discard the proposals (Esc)"
        className={`${buttonClass} bg-neutral-700 hover:bg-neutral-800`}
      >
        Discard
      </button>
    </div>
  );
}
