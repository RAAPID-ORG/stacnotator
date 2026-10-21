import { useState } from 'react';
import { Button, Input } from '~/shared/ui/forms';
import { groupByDate, type AssetRule, type SelectionRow } from './importFiles';

export const FileGrouping = ({
  rows,
  datePattern,
  onDatePatternChange,
  onGroup,
  onApply,
}: {
  rows: Map<string, SelectionRow>;
  datePattern: string;
  onDatePatternChange: (pattern: string) => void;
  onGroup: () => void;
  onApply: (result: ReturnType<typeof groupByDate>) => void;
}) => {
  const [rules, setRules] = useState<AssetRule[]>([{ name: '', pattern: '' }]);
  const change = (index: number, update: Partial<AssetRule>) =>
    setRules((previous) =>
      previous.map((rule, i) => (i === index ? { ...rule, ...update } : rule))
    );
  const selectedCount = [...rows.values()].filter((row) => row.selected).length;
  const hasRules = rules.length > 0 && rules.every((rule) => rule.name && rule.pattern);
  const preview = hasRules ? groupByDate(rows, rules, datePattern) : null;
  const matched = preview
    ? [...preview.rows.values()].filter((row) => row !== rows.get(row.object.path))
    : [];
  const groups = new Map<string, SelectionRow[]>();
  for (const row of matched) {
    if (!row.itemKey) continue;
    const members = groups.get(row.itemKey) ?? [];
    members.push(row);
    groups.set(row.itemKey, members);
  }

  return (
    <details className="rounded-md border border-neutral-200 p-3 space-y-3 text-xs">
      <summary className="cursor-pointer font-medium text-neutral-700">
        Group files into items (optional)
      </summary>
      <p className="text-neutral-500">
        An item is one observation with a shared date. Its files are named assets, such as
        reflectance and clear-count. Without grouping, each file is a separate item.
      </p>
      <h4 className="font-medium text-neutral-800">Group matching files by date</h4>
      <p className="text-neutral-500">
        Name each type of file and enter the part of its filename to match. Patterns also accept
        regular expressions. Unmatched files stay unchanged.
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
            <Input
              size="sm"
              aria-label={`File pattern rule ${index + 1}`}
              placeholder="_reflectance"
              value={rule.pattern}
              onChange={(e) => change(index, { pattern: e.target.value })}
            />
          </label>
          <Button
            size="sm"
            variant="quiet"
            aria-label={`Remove rule ${index + 1}`}
            onClick={() => setRules((previous) => previous.filter((_, i) => i !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="quiet"
        onClick={() => setRules((previous) => [...previous, { name: '', pattern: '' }])}
      >
        Add asset rule
      </Button>
      <details className="space-y-2">
        <summary className="cursor-pointer text-neutral-600">How dates are found</summary>
        <p className="text-neutral-500">
          Uses dates you entered, or reads them from filenames. For example, 2025-01 produces one
          item covering January. Change the pattern below only for a different naming format.
        </p>
        <label className="block space-y-1">
          <span>Date pattern (regular expression)</span>
          <Input
            size="sm"
            aria-label="Group date pattern"
            value={datePattern}
            onChange={(e) => onDatePatternChange(e.target.value)}
          />
        </label>
      </details>
      {preview && !preview.errors.length && (
        <div className="rounded bg-neutral-50 p-2 space-y-1" aria-label="Grouping preview">
          <p className="font-medium">
            {matched.length} matching files → {groups.size} dated items
          </p>
          <p className="text-neutral-500">
            {selectedCount - matched.length} selected{' '}
            {selectedCount - matched.length === 1 ? 'file' : 'files'} unchanged.
          </p>
          {[...groups].slice(0, 3).map(([key, members]) => (
            <p key={key} className="break-words">
              {members[0].time.kind === 'instant'
                ? members[0].time.value
                : `${members[0].time.start} – ${members[0].time.end}`}
              {' · '}
              {members.map((row) => row.assetKey).join(', ')}
            </p>
          ))}
          {groups.size > 3 && <p className="text-neutral-500">And {groups.size - 3} more items.</p>}
        </div>
      )}
      {preview && preview.errors.length > 0 && (
        <p role="alert" className="whitespace-pre-line text-red-600">
          {preview.errors.join('\n')}
        </p>
      )}
      <Button
        size="sm"
        variant="secondary"
        disabled={!preview || preview.errors.length > 0}
        onClick={() => preview && onApply(preview)}
      >
        Apply grouping
      </Button>
      <div className="border-t pt-3 space-y-2">
        <h4 className="font-medium text-neutral-800">Or choose files manually</h4>
        <p className="text-neutral-500">
          Select only the files for one observation in the list below, then combine them.
        </p>
        <Button size="sm" variant="secondary" disabled={selectedCount < 2} onClick={onGroup}>
          Group selected as one item
        </Button>
      </div>
    </details>
  );
};
