import { useState } from 'react';
import {
  addVisualizerFeedback,
  type CategoricalEntry,
  type VisualizerFeedbackCreate,
  type VisualizerViewOut,
} from '~/api/client';
import { useLayoutStore } from '~/shared/stores/layout.store';
import { Button, Field, Select, Textarea } from '~/shared/ui/forms';
import { pillCls } from '~/shared/ui/pill';
import { handleError } from '~/shared/utils/errorHandler';
import type { Bbox } from '~/shared/map/types';

/**
 * What someone looking at the map says about one place on it.
 *
 * The useful case is disagreeing with a prediction, so when the layer being
 * commented on has classes, the form offers them: picking one says what it
 * should have been, which is worth more to whoever reads it than prose. A layer
 * without classes, or none at all, leaves the note doing the work.
 */
export function FeedbackPanel({
  view,
  area,
  viewing,
  onClose,
  onSaved,
}: {
  view: VisualizerViewOut;
  area: Bbox;
  viewing: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const layers = classifiedOverlays(view);
  const [overlayId, setOverlayId] = useState<number | null>(layers[0]?.id ?? null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [suggested, setSuggested] = useState<CategoricalEntry | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const showAlert = useLayoutStore((s) => s.showAlert);

  const layer = layers.find((entry) => entry.id === overlayId) ?? null;
  const valid = verdict !== null || suggested !== null || note.trim().length > 0;

  const submit = async () => {
    setSaving(true);
    try {
      await addVisualizerFeedback({
        path: { slug: view.slug },
        body: {
          area: { west: area[0], south: area[1], east: area[2], north: area[3] },
          overlay_id: layer?.id ?? null,
          verdict,
          suggested_value: suggested?.value ?? null,
          suggested_label: suggested ? suggested.label || String(suggested.value) : null,
          note: note.trim() || null,
          viewing,
        },
      });
      showAlert('Thanks - your feedback was sent', 'success');
      onSaved();
    } catch (error) {
      handleError(error, 'Could not send your feedback');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="pointer-events-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white/95 shadow-xl backdrop-blur-sm"
      data-testid="visualizer-feedback-panel"
    >
      <div className="border-b border-neutral-100 px-4 pb-2 pt-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
          Feedback on this area
        </p>
        {viewing && <p className="mt-0.5 truncate text-xs text-neutral-500">{viewing}</p>}
      </div>

      <div className="space-y-3 p-4">
        {/* Answerable in one click, so feedback can be counted rather than only
            read. Everything below it stays optional. */}
        <div className="flex gap-1.5">
          {VERDICTS.map(({ value, label, idle, on }) => (
            <button
              key={value}
              type="button"
              data-testid="feedback-verdict"
              data-value={value}
              data-active={verdict === value}
              onClick={() => setVerdict((current) => (current === value ? null : value))}
              // Never pillCls's own active state: these carry their own colour.
              className={pillCls(
                false,
                `!h-8 flex-1 justify-center !text-xs ${verdict === value ? on : idle}`
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {layers.length > 1 && (
          <Field label="About" htmlFor="feedback-layer">
            <Select
              id="feedback-layer"
              size="sm"
              value={String(overlayId ?? '')}
              onChange={(e) => {
                setOverlayId(e.target.value ? Number(e.target.value) : null);
                setSuggested(null);
              }}
            >
              {layers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {layer && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-neutral-700">
              It should be{layers.length === 1 ? ` (${layer.name})` : ''}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {layer.entries.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  data-testid="feedback-class"
                  onClick={() =>
                    setSuggested((current) => (current?.value === entry.value ? null : entry))
                  }
                  className={pillCls(
                    suggested?.value === entry.value,
                    '!h-7 !gap-1 !px-2.5 !text-xs'
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10"
                    style={{ backgroundColor: entry.color }}
                  />
                  {entry.label || entry.value}
                </button>
              ))}
            </div>
          </div>
        )}

        <Field
          label="Note"
          htmlFor="feedback-note"
          hint={valid && !note ? 'Optional - add it if there is more to say.' : undefined}
        >
          <Textarea
            id="feedback-note"
            rows={3}
            value={note}
            placeholder="What is wrong here, and how do you know?"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-4 py-2.5">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!valid || saving} onClick={() => void submit()}>
          {saving ? 'Sending…' : 'Send feedback'}
        </Button>
      </div>
    </div>
  );
}

type Verdict = VisualizerFeedbackCreate['verdict'];

/** Tinted the way badges and alerts are tinted elsewhere: the colour carries
 *  the meaning, the border carries the choice. */
const VERDICTS: { value: NonNullable<Verdict>; label: string; idle: string; on: string }[] = [
  {
    value: 'good',
    label: 'Looks good',
    idle: '!border-green-200 !text-green-800 hover:!bg-green-50',
    on: '!border-green-600 !bg-green-50 !text-green-900',
  },
  {
    value: 'wrong',
    label: 'Looks wrong',
    idle: '!border-red-200 !text-red-800 hover:!bg-red-50',
    on: '!border-red-600 !bg-red-50 !text-red-900',
  },
];

interface ClassifiedOverlay {
  id: number;
  name: string;
  entries: CategoricalEntry[];
}

/** The overlays a viewer could name a different class on: raster layers drawn
 *  from a fixed set of classes rather than a continuous scale. */
function classifiedOverlays(view: VisualizerViewOut): ClassifiedOverlay[] {
  return view.overlays.flatMap((overlay) =>
    overlay.kind === 'raster' &&
    overlay.render_config.mode === 'categorical' &&
    overlay.render_config.entries?.length
      ? [{ id: overlay.id, name: overlay.name, entries: overlay.render_config.entries }]
      : []
  );
}
