import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COUNTRY_BBOXES } from '~/features/campaigns/utils/countryBboxes';
import { BASEMAP_STYLE_URL } from '~/shared/imagery/tileUrls';
import { Camera } from '~/shared/map/Camera';
import { MapView } from '~/shared/map/MapView';
import type { Bbox, LayerSpec, StyleSpec } from '~/shared/map/types';
import { Input } from '~/shared/ui/forms';

interface BboxValue {
  bbox_west: number;
  bbox_south: number;
  bbox_east: number;
  bbox_north: number;
}

interface BoundingBoxEditorProps {
  /** Replaces the default heading, or drops it when null - a caller that has
   *  already introduced the area does not want it introduced twice. */
  heading?: { title: string; description: string } | null;
  /** The country picker. Off for callers bringing their own place search. */
  showCountrySearch?: boolean;
  value: BboxValue;
  onChange: (updates: Partial<BboxValue>) => void;
}

const BASEMAP: LayerSpec[] = [
  { kind: 'gl-style', id: 'bbox-basemap', styleUrl: BASEMAP_STYLE_URL },
];
const BOX_STYLE: StyleSpec = {
  stroke: { color: '#326247', width: 2, dash: [5, 5] },
  fill: { color: 'rgba(50, 98, 71, 0.2)' },
  circle: { radius: 7, stroke: { color: '#ffffff', width: 2 }, fill: { color: '#326247' } },
};
const FIT_PADDING_PX = 50;

/**
 * A dragged rectangle as the campaign's area.
 *
 * The map reports longitudes unwrapped, so dragging the box west past the
 * antimeridian returns -196 rather than 164. Both edges shift by the same
 * multiple of 360 - the box keeps its shape and its place - which lands west
 * back in range. A box that genuinely straddles 180 comes out with east past
 * it, and validation reports that rather than this quietly moving it.
 */
function toValue([west, south, east, north]: Bbox): BboxValue {
  const shift = -360 * Math.floor((west + 180) / 360);
  // Five decimals is about a metre - finer than anyone drags.
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  return {
    bbox_west: round(west + shift),
    bbox_south: round(south),
    bbox_east: round(east + shift),
    bbox_north: round(north),
  };
}

function validBbox(value: BboxValue): Bbox | null {
  const bbox: Bbox = [value.bbox_west, value.bbox_south, value.bbox_east, value.bbox_north];
  if (!bbox.every(Number.isFinite) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return null;
  return bbox;
}

export const BoundingBoxEditor = ({
  value,
  onChange,
  heading,
  showCountrySearch = true,
}: BoundingBoxEditorProps) => {
  const { t } = useTranslation('campaigns');
  const shownHeading =
    heading === undefined
      ? { title: t('bbox.title'), description: t('bbox.description') }
      : heading;
  const camera = useRef<Camera>(null);
  camera.current ??= new Camera({ center: [0, 0], zoom: 2 });
  // The last box this map produced itself: the map is already showing it, so
  // the value coming back for it must not refit the view mid-adjustment.
  const fromMapRef = useRef<string | null>(null);

  // Country search state
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const filteredCountries =
    searchQuery.length > 0
      ? COUNTRY_BBOXES.filter((c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase())
        ).slice(0, 8)
      : [];

  const handleSelectCountry = (country: (typeof COUNTRY_BBOXES)[number]) => {
    const [west, south, east, north] = country.bbox;
    onChange({ bbox_west: west, bbox_south: south, bbox_east: east, bbox_north: north });
    setSearchQuery('');
    setShowSuggestions(false);
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const bbox = validBbox(value);
  const bboxKey = bbox?.join() ?? null;

  useEffect(() => {
    if (!bbox || bboxKey === fromMapRef.current) return;
    camera.current?.fitBounds(bbox, { paddingPx: FIT_PADDING_PX });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bboxKey is the bbox's identity
  }, [bboxKey]);

  const onBoxChange = (drawn: Bbox) => {
    const next = toValue(drawn);
    fromMapRef.current = [next.bbox_west, next.bbox_south, next.bbox_east, next.bbox_north].join();
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {shownHeading && (
        <div>
          <h3 className="section-heading">{shownHeading.title}</h3>
          <p className="section-description">{shownHeading.description}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Search + Coordinate Inputs */}
        <div className="lg:col-span-1 space-y-4">
          {/* Country / Region Search */}
          <div className={`relative ${showCountrySearch ? '' : 'hidden'}`} ref={searchRef}>
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none"
                >
                  <path
                    fillRule="evenodd"
                    d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
                    clipRule="evenodd"
                  />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => searchQuery.length > 0 && setShowSuggestions(true)}
                  placeholder={t('bbox.searchPlaceholder')}
                  className="w-full pl-8 pr-3 py-2 text-sm border border-neutral-300 rounded-lg focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                />
              </div>
              <div className="relative group">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4 text-neutral-400 group-hover:text-neutral-600 transition-colors cursor-help shrink-0"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.94 6.94a.75.75 0 1 1-1.061-1.061 3 3 0 1 1 2.871 5.026v.345a.75.75 0 0 1-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 1 0 8.94 6.94ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                    clipRule="evenodd"
                  />
                </svg>
                <div className="absolute bottom-full right-0 mb-1.5 w-64 px-2.5 py-2 bg-neutral-800 text-white text-[11px] leading-relaxed rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 pointer-events-none z-50">
                  {t('bbox.sourceNote')}
                  <div className="absolute top-full right-2 border-4 border-transparent border-t-neutral-800"></div>
                </div>
              </div>
            </div>
            {showSuggestions && filteredCountries.length > 0 && (
              <ul className="absolute z-50 mt-1 w-full bg-white border border-neutral-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {filteredCountries.map((country) => (
                  <li key={country.name}>
                    <button
                      type="button"
                      onClick={() => handleSelectCountry(country)}
                      className="w-full text-left px-3 py-2 text-sm text-neutral-800 hover:bg-brand-50 hover:text-brand-700 transition-colors focus:outline-none cursor-pointer"
                    >
                      {country.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showSuggestions && searchQuery.length > 0 && filteredCountries.length === 0 && (
              <div className="absolute z-50 mt-1 w-full bg-white border border-neutral-200 rounded-lg shadow-lg px-3 py-2 text-sm text-neutral-500">
                {t('bbox.noResults')}
              </div>
            )}
          </div>

          {/* Coordinate Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-neutral-700">{t('bbox.west')}</span>
              <Input
                type="number"
                step="any"
                value={value.bbox_west}
                onChange={(e) => onChange({ bbox_west: Number(e.target.value) })}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-neutral-700">{t('bbox.south')}</span>
              <Input
                type="number"
                step="any"
                value={value.bbox_south}
                onChange={(e) => onChange({ bbox_south: Number(e.target.value) })}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-neutral-700">{t('bbox.east')}</span>
              <Input
                type="number"
                step="any"
                value={value.bbox_east}
                onChange={(e) => onChange({ bbox_east: Number(e.target.value) })}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-neutral-700">{t('bbox.north')}</span>
              <Input
                type="number"
                step="any"
                value={value.bbox_north}
                onChange={(e) => onChange({ bbox_north: Number(e.target.value) })}
              />
            </label>

            <div className="col-span-2 text-xs text-neutral-500 mt-1">{t('bbox.dragHint')}</div>
          </div>
        </div>

        {/* Map */}
        <div className="lg:col-span-2">
          <div className="w-full h-64 rounded-lg border border-neutral-200 overflow-hidden">
            <MapView
              camera={camera.current}
              layers={BASEMAP}
              interactions={
                bbox ? { box: { bbox, onChange: onBoxChange, style: BOX_STYLE } } : undefined
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};
