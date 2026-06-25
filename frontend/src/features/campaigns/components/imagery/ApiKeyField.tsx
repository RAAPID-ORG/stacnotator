import { useState } from 'react';
import { Input } from '~/shared/ui/forms';

interface ApiKeyFieldProps {
  /** False in the create wizard (entity not saved yet) — the key can't be set until saved. */
  persisted: boolean;
  /** Whether a key is already configured server-side. */
  hasApiKey?: boolean;
  /** Persist the entered key. Resolves true on success. */
  onSave: (value: string) => Promise<boolean>;
}

/**
 * Write-only provider API key control. The value is sent straight to the backend (encrypted
 * at rest) and never read back; we only ever show whether a key is configured. Available for
 * persisted basemaps/sources only — newly added ones must be saved first.
 */
export const ApiKeyField = ({ persisted, hasApiKey, onSave }: ApiKeyFieldProps) => {
  const [value, setValue] = useState('');
  const [configured, setConfigured] = useState(!!hasApiKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const explainer = (
    <p className="text-[11px] text-neutral-500 leading-snug">
      This provider needs an API key to serve its tiles. The key is encrypted on the server and used
      only to load tiles on each annotator&apos;s behalf — it is never sent to their browser, shown
      in tile links, or visible to them. You can update or replace it any time.
    </p>
  );

  if (!persisted) {
    return (
      <div className="mt-1 space-y-1">
        {explainer}
        <p className="text-[11px] text-neutral-400 italic">
          Save imagery first, then enter the key here.
        </p>
      </div>
    );
  }

  const save = async () => {
    const v = value.trim();
    if (!v) return;
    setSaving(true);
    setError(null);
    const ok = await onSave(v);
    setSaving(false);
    if (!ok) {
      setError('Failed to save key');
      return;
    }
    setConfigured(true);
    setValue('');
  };

  return (
    <div className="mt-1 space-y-1">
      {explainer}
      <div className="flex items-center gap-2">
        <Input
          size="sm"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={configured ? 'Replace API key' : 'Paste provider API key'}
          autoComplete="off"
          className="!w-56 text-[11px] font-mono"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !value.trim()}
          className="text-xs text-brand-700 hover:text-brand-900 underline underline-offset-4 decoration-brand-300 hover:decoration-brand-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save key'}
        </button>
        {error ? (
          <span className="text-[11px] text-red-600">{error}</span>
        ) : configured ? (
          <span className="text-[11px] text-emerald-600">Key configured ✓</span>
        ) : (
          <span className="text-[11px] text-amber-600">No key set</span>
        )}
      </div>
    </div>
  );
};
