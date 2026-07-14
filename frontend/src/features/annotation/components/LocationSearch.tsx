import { useEffect, useRef, useState } from 'react';
import { IconClose, IconSearch } from '~/shared/ui/Icons';
import { buildPhotonUrl, parseGeocodingResponse, type GeocodingResult } from '../utils/geocoding';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;

interface LocationSearchProps {
  /** Controlled expand state: collapsed renders only the magnifier icon button. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (result: GeocodingResult) => void;
  className?: string;
}

/** Type-ahead place search over Photon, collapsed behind an icon until opened.
 * A geocoder hiccup must never surface as an error in the annotation flow -
 * failed/aborted lookups just clear the suggestion list. */
export const LocationSearch = ({
  expanded,
  onExpandedChange,
  onSelect,
  className,
}: LocationSearchProps) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Selecting a result writes state that the [query] effect must not treat as
  // a fresh search - without this guard it would re-fetch and re-open the
  // dropdown ~300ms after every selection.
  const justSelectedRef = useRef(false);

  useEffect(() => {
    abortRef.current?.abort();
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      setIsLoading(true);
      fetch(buildPhotonUrl(trimmed), { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('geocoding failed'))))
        .then((data: unknown) => {
          if (controller.signal.aborted) return;
          const results = parseGeocodingResponse(data);
          setSuggestions(results);
          setHighlightIndex(0);
          setIsOpen(results.length > 0);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setIsOpen(false);
        })
        .finally(() => {
          if (controller.signal.aborted) return;
          setIsLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const collapse = () => {
    abortRef.current?.abort();
    setQuery('');
    setSuggestions([]);
    setIsOpen(false);
    setIsLoading(false);
    onExpandedChange(false);
  };

  const selectResult = (result: GeocodingResult) => {
    onSelect(result);
    justSelectedRef.current = true;
    collapse();
  };

  // Collapsing/blurring flips document.activeElement before this event
  // reaches the document-level hotkey listener, which would otherwise read
  // isTyping=false and reinterpret the same keypress as a hotkey (e.g. Enter
  // submitting the current task). stopPropagation, matching the goto-task
  // input's convention, keeps the keypress ours alone.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      collapse();
      return;
    }
    if (!isOpen || suggestions.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setHighlightIndex((i) => (i + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setHighlightIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        selectResult(suggestions[highlightIndex] ?? suggestions[0]);
        break;
    }
  };

  return (
    <div className={`flex items-center min-w-0 ${className ?? ''}`}>
      {!expanded && (
        <button
          type="button"
          onClick={() => onExpandedChange(true)}
          className="p-1 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
          title="Search location"
          data-testid="location-search-toggle"
        >
          <IconSearch className="w-3 h-3" />
        </button>
      )}
      <div
        className={`relative transition-all duration-200 ${
          expanded ? 'w-full opacity-100' : 'w-0 opacity-0 overflow-hidden pointer-events-none'
        }`}
      >
        <div className="relative">
          {isLoading ? (
            <span
              className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin rounded-full border border-neutral-300 border-t-brand-600"
              data-testid="location-search-loading"
            />
          ) : (
            <IconSearch className="w-3 h-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setIsOpen(false)}
            onFocus={() => setIsOpen(suggestions.length > 0)}
            tabIndex={expanded ? 0 : -1}
            placeholder="Search location…"
            // select-text overrides the card-header's user-select: none.
            className="w-full pl-6 pr-6 py-0.5 text-xs font-normal text-neutral-900 bg-white border border-neutral-300 rounded select-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-400"
          />
          <button
            type="button"
            // Runs on mousedown-before-blur, so preventDefault keeps the click
            // from racing the input's dropdown-closing blur handler.
            onMouseDown={(e) => e.preventDefault()}
            onClick={collapse}
            tabIndex={expanded ? 0 : -1}
            className="absolute right-0.5 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
            title="Close search"
            data-testid="location-search-close"
          >
            <IconClose className="w-3 h-3" />
          </button>
        </div>
        {isOpen && suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-neutral-200 rounded shadow-lg text-xs font-normal z-[1100]">
            {suggestions.map((result, index) => (
              <li key={`${result.label}-${result.center[0]}-${result.center[1]}`}>
                <button
                  type="button"
                  // Blur fires before click - preventDefault on mousedown keeps focus so
                  // the click still lands and selects instead of racing the blur close.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectResult(result)}
                  onMouseEnter={() => setHighlightIndex(index)}
                  className={`w-full text-left px-2 py-1.5 truncate ${
                    index === highlightIndex
                      ? 'bg-brand-50 text-brand-800'
                      : 'text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  {result.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
