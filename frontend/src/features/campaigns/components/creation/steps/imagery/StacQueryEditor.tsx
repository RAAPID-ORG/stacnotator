import { useState, useEffect, useCallback, useRef } from 'react';

interface StacQueryEditorProps {
  /** Current search query (null = auto-generated from UI fields) */
  value: Record<string, unknown> | null;
  /** Called when query changes. null means reset to auto-generated. */
  onChange: (query: Record<string, unknown> | null) => void;
  /** Auto-generated query from UI fields (shown when value is null) */
  autoQuery: Record<string, unknown>;
  /** Label for the collapsible section */
  label?: string;
}

/**
 * Collapsible JSON editor for custom CQL2-JSON STAC search queries.
 *
 * Two modes:
 * - Auto (value=null): JSON is derived from UI fields, shown read-only with "Customize" button
 * - Custom (value set): JSON textarea is editable, UI fields become indicators
 */
export const StacQueryEditor = ({
  value,
  onChange,
  autoQuery,
  label = 'Advanced: Custom Search Query',
}: StacQueryEditorProps) => {
  const [expanded, setExpanded] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isCustom = value !== null;

  // Sync jsonText from value or autoQuery
  useEffect(() => {
    const source = isCustom ? value : autoQuery;
    setJsonText(JSON.stringify(source, null, 2));
    setParseError(null);
  }, [value, autoQuery, isCustom]);

  const handleTextChange = useCallback(
    (text: string) => {
      setJsonText(text);
      try {
        const parsed = JSON.parse(text);
        setParseError(null);
        onChange(parsed);
      } catch (e) {
        setParseError((e as Error).message);
      }
    },
    [onChange]
  );

  const handleCustomize = useCallback(() => {
    // Switch from auto to custom mode
    onChange(autoQuery);
  }, [onChange, autoQuery]);

  const handleReset = useCallback(() => {
    onChange(null);
    setParseError(null);
  }, [onChange]);

  return (
    <div className="border border-neutral-200 rounded">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-neutral-600 hover:text-neutral-800 hover:bg-neutral-50 transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">{label}</span>
        {isCustom && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">
            Custom
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-neutral-200 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-neutral-500">
              {isCustom
                ? 'Custom CQL2-JSON query (bbox and datetime injected by backend)'
                : 'Auto-generated from UI fields'}
            </span>
            <div className="flex gap-1.5">
              {!isCustom ? (
                <button
                  type="button"
                  onClick={handleCustomize}
                  className="text-[10px] px-2 py-0.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-600 rounded transition-colors"
                >
                  Customize
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-[10px] px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded transition-colors"
                >
                  Reset to auto
                </button>
              )}
            </div>
          </div>

          <textarea
            ref={textareaRef}
            value={jsonText}
            onChange={(e) => handleTextChange(e.target.value)}
            readOnly={!isCustom}
            className={`w-full font-mono text-[11px] leading-relaxed p-2 border rounded resize-y min-h-[120px] max-h-[400px] ${
              !isCustom
                ? 'bg-neutral-50 text-neutral-500 cursor-default'
                : parseError
                  ? 'border-red-300 bg-red-50/30'
                  : 'border-neutral-300 bg-white'
            }`}
            spellCheck={false}
          />

          {parseError && (
            <div className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
              Invalid JSON: {parseError}
            </div>
          )}

          {isCustom && (
            <div className="text-[10px] text-neutral-400 leading-snug">
              Use <code className="bg-neutral-100 px-1 rounded">{'{sliceStart}'}</code> and{' '}
              <code className="bg-neutral-100 px-1 rounded">{'{sliceEnd}'}</code> as placeholders
              for per-slice date ranges. Bbox is injected automatically from campaign settings.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
