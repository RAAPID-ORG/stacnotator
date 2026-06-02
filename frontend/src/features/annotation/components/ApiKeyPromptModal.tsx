import { useState } from 'react';
import { Modal } from '~/shared/ui/Modal';
import { useApiKeyStore } from '../stores/apiKey.store';

export interface MissingApiKey {
  scopedKey: string;
  label: string;
}

interface ApiKeyPromptModalProps {
  missingKeys: MissingApiKey[];
  onDone: () => void;
}

export const ApiKeyPromptModal = ({ missingKeys, onDone }: ApiKeyPromptModalProps) => {
  const setKey = useApiKeyStore((s) => s.setKey);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(missingKeys.map((k) => [k.scopedKey, '']))
  );
  const [acknowledged, setAcknowledged] = useState(false);

  const handleSave = () => {
    for (const { scopedKey } of missingKeys) {
      const v = values[scopedKey];
      if (v?.trim()) setKey(scopedKey, v.trim());
    }
    onDone();
  };

  return (
    <Modal
      title="API Keys Required"
      onClose={onDone}
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDone}
            className="px-3 py-1.5 text-sm text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!acknowledged}
            className="px-4 py-1.5 text-sm font-medium bg-brand-600 text-white rounded-md hover:bg-brand-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      }
    >
      <div className="px-5 py-4 space-y-4">
        <p className="text-sm text-neutral-600">
          {missingKeys.length === 1
            ? 'One imagery source on this campaign requires an API key to load tiles.'
            : `${missingKeys.length} imagery sources on this campaign require API keys to load tiles.`}{' '}
          Values are saved only in this browser and never sent to our servers.
        </p>

        <div className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-3 space-y-2">
          <p className="text-xs font-semibold text-amber-800">Use read-only API keys only</p>
          <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
            <li>
              Only paste keys with <strong>read-only</strong> permissions. If compromised, it cannot
              be used to create, modify, or delete data on the provider.
            </li>
            <li>
              Keys are stored in <strong>localStorage</strong> - low risk on a trusted device, but
              avoid keys with write access.
            </li>
            <li>
              Keys appear in <strong>tile network requests</strong>, just as they do in any mapping
              application (Mapbox, Google Maps, etc.).
            </li>
          </ul>
        </div>

        <div className="space-y-3">
          {missingKeys.map(({ scopedKey, label }) => (
            <div key={scopedKey} className="space-y-1">
              <label className="text-xs font-medium text-neutral-700">{label}</label>
              <input
                type="password"
                value={values[scopedKey] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [scopedKey]: e.target.value }))}
                placeholder="Paste your API key here"
                className="w-full border border-neutral-300 rounded-md px-2.5 py-1.5 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 outline-none transition-colors"
                autoComplete="off"
              />
            </div>
          ))}
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 shrink-0 accent-brand-600"
          />
          <span className="text-xs text-neutral-600">
            I understand the above, and I am providing <strong>read-only</strong> key
            {missingKeys.length > 1 ? 's' : ''}.
          </span>
        </label>
      </div>
    </Modal>
  );
};
