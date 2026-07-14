import { useEffect, useRef, useState } from 'react';
import { IconSearch } from '~/shared/ui/Icons';
import { buildPhotonUrl, parseGeocodingResponse, type GeocodingResult } from '../utils/geocoding';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;

interface LocationSearchProps {
  onSelect: (result: GeocodingResult) => void;
  className?: string;
}

/** Type-ahead place search over Photon. A geocoder hiccup must never surface
 * as an error in the annotation flow - failed/aborted lookups just clear
 * the suggestion list. */
export const LocationSearch = ({ onSelect, className }: LocationSearchProps) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    abortRef.current?.abort();

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

  const selectResult = (result: GeocodingResult) => {
    onSelect(result);
    setQuery(result.label);
    setSuggestions([]);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  // Blurring on Enter/Escape flips document.activeElement before this event
  // reaches the document-level hotkey listener, which would otherwise read
  // isTyping=false and reinterpret the same keypress as a hotkey (e.g. Enter
  // submitting the current task). stopPropagation, matching the goto-task
  // input's convention, keeps the keypress ours alone.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        inputRef.current?.blur();
      }
      return;
    }
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
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      <div className="relative">
        {isLoading ? (
          <span
            className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin rounded-full border border-neutral-300 border-t-brand-600"
            data-testid="location-search-loading"
          />
        ) : (
          <IconSearch className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setIsOpen(false)}
          onFocus={() => setIsOpen(suggestions.length > 0)}
          placeholder="Search location…"
          className="w-full pl-7 pr-2 py-1 text-xs text-neutral-900 bg-white border border-neutral-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-400"
        />
      </div>
      {isOpen && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-neutral-200 rounded shadow-lg text-xs">
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
  );
};
