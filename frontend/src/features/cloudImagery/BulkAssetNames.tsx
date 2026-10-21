import { useState } from 'react';
import { IconButton, Input } from '~/shared/ui/forms';
import { IconCheck, IconClose, IconPlus } from '~/shared/ui/Icons';
import { assignAssets, type AssetRule, type SelectionRow } from './importFiles';

export const BulkAssetNames = ({
  rows,
  onApply,
}: {
  rows: Map<string, SelectionRow>;
  onApply: (result: ReturnType<typeof assignAssets>) => void;
}) => {
  const [rules, setRules] = useState<AssetRule[]>([{ name: '', pattern: '' }]);
  const [matchingOnly, setMatchingOnly] = useState(false);
  const change = (index: number, update: Partial<AssetRule>) =>
    setRules((previous) =>
      previous.map((rule, i) => (i === index ? { ...rule, ...update } : rule))
    );
  const candidates = [...rows.values()].filter((row) => matchingOnly || row.selected);
  const hasRules = rules.length > 0 && rules.every((rule) => rule.name && rule.pattern);
  const preview = hasRules ? assignAssets(rows, rules, matchingOnly) : null;
  const counts = rules.map((rule) => {
    if (!rule.pattern.trim()) return '';
    try {
      const pattern = new RegExp(rule.pattern);
      const count = candidates.filter((row) => pattern.test(row.object.path)).length;
      return `${count} ${count === 1 ? 'match' : 'matches'}`;
    } catch {
      return 'Invalid pattern';
    }
  });

  return (
    <details className="space-y-2 text-xs">
      <summary className="cursor-pointer text-neutral-700">
        Set asset names in bulk (optional)
      </summary>
      <p className="text-neutral-500">
        Name matching files without changing their dates. Patterns accept regular expressions.
      </p>
      {rules.map((rule, index) => (
        <div key={index} className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1">
            <span>Asset name</span>
            <Input
              size="sm"
              aria-label={`Asset name rule ${index + 1}`}
              placeholder="reflectance"
              value={rule.name}
              onChange={(e) => change(index, { name: e.target.value })}
            />
          </label>
          <label className="min-w-0 flex-[2] space-y-1">
            <span>Filename contains / pattern</span>
            <div className="flex items-center gap-2">
              <Input
                size="sm"
                className="min-w-0 flex-1"
                aria-label={`File pattern rule ${index + 1}`}
                placeholder="_reflectance"
                value={rule.pattern}
                onChange={(e) => change(index, { pattern: e.target.value })}
              />
              <span
                className="shrink-0 text-neutral-500"
                aria-label={`Matches for asset rule ${index + 1}`}
                aria-live="polite"
              >
                {counts[index]}
              </span>
            </div>
          </label>
          <IconButton
            className="h-8"
            aria-label={`Remove rule ${index + 1}`}
            title={`Remove rule ${index + 1}`}
            onClick={() => setRules((previous) => previous.filter((_, i) => i !== index))}
          >
            <IconClose className="h-4 w-4" />
          </IconButton>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <IconButton
          tone="brand"
          aria-label="Add asset rule"
          title="Add asset rule"
          onClick={() => setRules((previous) => [...previous, { name: '', pattern: '' }])}
        >
          <IconPlus className="h-4 w-4" />
        </IconButton>
        <label className="flex items-center gap-1.5 text-neutral-600">
          <input
            type="checkbox"
            checked={matchingOnly}
            onChange={(e) => setMatchingOnly(e.target.checked)}
          />
          Auto-select matching files only
        </label>
        <IconButton
          tone="brand"
          className="gap-1 text-xs"
          aria-label="Apply asset names"
          title="Apply asset names"
          disabled={!preview || preview.errors.length > 0}
          onClick={() => preview && onApply(preview)}
        >
          <IconCheck className="h-3.5 w-3.5" />
          Apply
        </IconButton>
      </div>
      {preview && preview.errors.length > 0 && (
        <p role="alert" className="whitespace-pre-line text-red-600">
          {preview.errors.join('\n')}
        </p>
      )}
    </details>
  );
};
