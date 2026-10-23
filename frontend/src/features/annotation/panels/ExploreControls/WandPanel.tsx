import { SEGMENTATION_MODELS } from '~/shared/segmentation/models';
import type { ExtendedLabel } from '../../campaign/annotation';
import { useWandStore, type WandMode } from '../../stores/wand';

const segmentClass = (active: boolean) =>
  `flex-1 px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer first:rounded-l last:rounded-r border ${
    active
      ? 'bg-brand-50 text-brand-700 border-brand-600'
      : 'bg-neutral-50 text-neutral-600 border-neutral-200 hover:bg-neutral-100'
  }`;

/**
 * What the wand will do with the next box, and what it did with the last.
 * The model only downloads on first use, so until then the panel says how
 * big that download is.
 */
export function WandPanel({ label }: { label: ExtendedLabel | null }) {
  const mode = useWandStore((s) => s.mode);
  const status = useWandStore((s) => s.status);
  const backend = useWandStore((s) => s.backend);
  const lastRun = useWandStore((s) => s.lastRun);
  const waiting = useWandStore((s) => s.proposals.length);

  const prompt = label?.segment_prompt ?? null;
  const all = !!prompt && mode === 'all';
  const model = SEGMENTATION_MODELS[all ? 'text' : 'box'];
  const setMode = (next: WandMode) => useWandStore.getState().setMode(next);

  return (
    <div className="flex flex-col gap-1.5 w-full" data-testid="wand-panel" data-wand-mode={mode}>
      <span className="font-semibold text-neutral-700 text-xs tracking-wide">Magic wand</span>
      {prompt && (
        <div className="flex" role="group" aria-label="What a box finds">
          <button
            type="button"
            aria-pressed={!all}
            onClick={() => setMode('object')}
            className={segmentClass(!all)}
          >
            The object in the box
          </button>
          <button
            type="button"
            aria-pressed={all}
            onClick={() => setMode('all')}
            className={segmentClass(all)}
            data-testid="wand-mode-all"
          >
            Every “{prompt}”
          </button>
        </div>
      )}
      <p className="text-[11px] text-neutral-500 leading-relaxed">
        {all
          ? `Drag a box over an area: every ${prompt} inside it is outlined.`
          : 'Drag a box around one object to outline it.'}{' '}
        The outlines are proposals until you accept them.
      </p>
      {backend === null && (
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          The first box downloads {model.title} (about {model.megabytes} MB) once; it runs in this
          browser after that.
        </p>
      )}
      {backend === 'wasm' && (
        <p className="text-[11px] text-amber-700 leading-relaxed" data-testid="wand-cpu-notice">
          This browser has no WebGPU, so segmenting runs on the CPU: expect tens of seconds a box,
          and minutes for a prompt.
        </p>
      )}
      {status.phase === 'error' && (
        <p className="text-[11px] text-red-600 leading-relaxed">{status.message}</p>
      )}
      {lastRun && status.phase === 'idle' && (
        <p className="text-[11px] text-neutral-500" data-testid="wand-last-run">
          Found {lastRun.found} in {(lastRun.millis / 1000).toFixed(1)} s at{' '}
          {lastRun.metresPerPixel.toFixed(lastRun.metresPerPixel < 10 ? 1 : 0)} m per pixel.
        </p>
      )}
      {waiting > 0 && (
        <p className="text-[11px] text-neutral-600 leading-relaxed">
          Click an outline to leave it out. <strong>Enter</strong> accepts, <strong>Esc</strong>{' '}
          discards.
        </p>
      )}
    </div>
  );
}
