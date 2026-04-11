import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { COUNTRY_BBOXES } from '~/features/campaigns/utils/countryBboxes';

interface BoundingBoxEditorProps {
  value: {
    bbox_west: number;
    bbox_south: number;
    bbox_east: number;
    bbox_north: number;
  };
  onChange: (updates: {
    bbox_west?: number;
    bbox_south?: number;
    bbox_east?: number;
    bbox_north?: number;
  }) => void;
}

export const BoundingBoxEditor = ({ value, onChange }: BoundingBoxEditorProps) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rectangleRef = useRef<L.Rectangle | null>(null);
  const markersRef = useRef<{ nw: L.Marker | null; se: L.Marker | null }>({ nw: null, se: null });
  const isUpdatingFromDragRef = useRef(false);
  const prevBboxRef = useRef<string>('');

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

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [0, 0],
      zoom: 2,
      zoomControl: true,
      attributionControl: true,
    });

    // Add CartoDB basemap
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OSM</a>, <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: ['a', 'b', 'c', 'd'],
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update rectangle when bbox changes
  useEffect(() => {
    if (!mapRef.current) return;

    // Don't update if we're in the middle of dragging
    if (isUpdatingFromDragRef.current) {
      isUpdatingFromDragRef.current = false;
      return;
    }

    const { bbox_west, bbox_south, bbox_east, bbox_north } = value;
    const bboxKey = `${bbox_west},${bbox_south},${bbox_east},${bbox_north}`;

    // Validate bbox
    if (
      isNaN(bbox_west) ||
      isNaN(bbox_south) ||
      isNaN(bbox_east) ||
      isNaN(bbox_north) ||
      bbox_west >= bbox_east ||
      bbox_south >= bbox_north
    ) {
      // Remove rectangle if invalid
      if (rectangleRef.current) {
        rectangleRef.current.remove();
        rectangleRef.current = null;
      }
      if (markersRef.current.nw) {
        markersRef.current.nw.remove();
        markersRef.current.nw = null;
      }
      if (markersRef.current.se) {
        markersRef.current.se.remove();
        markersRef.current.se = null;
      }
      prevBboxRef.current = '';
      return;
    }

    const bounds = L.latLngBounds([bbox_south, bbox_west], [bbox_north, bbox_east]);
    const bboxActuallyChanged = bboxKey !== prevBboxRef.current;
    prevBboxRef.current = bboxKey;

    if (rectangleRef.current) {
      // Update existing rectangle and markers
      rectangleRef.current.setBounds(bounds);
      if (markersRef.current.nw) {
        markersRef.current.nw.setLatLng([bbox_north, bbox_west]);
      }
      if (markersRef.current.se) {
        markersRef.current.se.setLatLng([bbox_south, bbox_east]);
      }
    } else {
      // Create new rectangle
      const rectangle = L.rectangle(bounds, {
        color: '#326247',
        weight: 2,
        fillOpacity: 0.2,
        dashArray: '5, 5',
      }).addTo(mapRef.current);

      rectangleRef.current = rectangle;

      // Make rectangle draggable to move entire bbox
      let isDragging = false;
      let dragStart: { lat: number; lng: number; bounds: L.LatLngBounds } | null = null;

      rectangle.on('mousedown', (e: L.LeafletMouseEvent) => {
        const originalEvent = e.originalEvent as MouseEvent;
        // Only start drag if not clicking on a corner marker
        if (!(originalEvent.target as HTMLElement).closest('.bbox-corner-marker')) {
          isDragging = true;
          dragStart = {
            lat: e.latlng.lat,
            lng: e.latlng.lng,
            bounds: rectangle.getBounds(),
          };
          mapRef.current!.dragging.disable();
          L.DomEvent.stopPropagation(e);
        }
      });

      const handleMouseMove = (e: L.LeafletMouseEvent) => {
        if (!isDragging || !dragStart) return;

        const deltaLat = e.latlng.lat - dragStart.lat;
        const deltaLng = e.latlng.lng - dragStart.lng;

        const newBounds = L.latLngBounds(
          [dragStart.bounds.getSouth() + deltaLat, dragStart.bounds.getWest() + deltaLng],
          [dragStart.bounds.getNorth() + deltaLat, dragStart.bounds.getEast() + deltaLng]
        );

        rectangle.setBounds(newBounds);
        if (markersRef.current.nw) {
          markersRef.current.nw.setLatLng([newBounds.getNorth(), newBounds.getWest()]);
        }
        if (markersRef.current.se) {
          markersRef.current.se.setLatLng([newBounds.getSouth(), newBounds.getEast()]);
        }
      };

      const handleMouseUp = () => {
        if (isDragging) {
          const newBounds = rectangle.getBounds();
          isUpdatingFromDragRef.current = true;
          onChange({
            bbox_west: newBounds.getWest(),
            bbox_south: newBounds.getSouth(),
            bbox_east: newBounds.getEast(),
            bbox_north: newBounds.getNorth(),
          });
          isDragging = false;
          dragStart = null;
          mapRef.current!.dragging.enable();
        }
      };

      mapRef.current.on('mousemove', handleMouseMove);
      mapRef.current.on('mouseup', handleMouseUp);
      document.addEventListener('mouseup', handleMouseUp);

      // Create corner markers - only NW (top-left) and SE (bottom-right)
      const createMarker = (lat: number, lng: number, isNW: boolean) => {
        const marker = L.marker([lat, lng], {
          draggable: true,
          icon: L.divIcon({
            html: `<div style="width: 14px; height: 14px; background: #326247; border: 2px solid white; border-radius: 50%; cursor: move; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>`,
            className: 'bbox-corner-marker',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          }),
        }).addTo(mapRef.current!);

        marker.on('drag', () => {
          const pos = marker.getLatLng();
          const currentBounds = rectangle.getBounds();

          let newWest = currentBounds.getWest();
          let newEast = currentBounds.getEast();
          let newSouth = currentBounds.getSouth();
          let newNorth = currentBounds.getNorth();

          if (isNW) {
            // Northwest corner (top-left)
            newNorth = pos.lat;
            newWest = pos.lng;
          } else {
            // Southeast corner (bottom-right)
            newSouth = pos.lat;
            newEast = pos.lng;
          }

          // Ensure valid bounds
          if (newWest < newEast && newSouth < newNorth) {
            const newBounds = L.latLngBounds([newSouth, newWest], [newNorth, newEast]);
            rectangle.setBounds(newBounds);

            // Update the other marker
            if (isNW && markersRef.current.se) {
              markersRef.current.se.setLatLng([newSouth, newEast]);
            } else if (!isNW && markersRef.current.nw) {
              markersRef.current.nw.setLatLng([newNorth, newWest]);
            }
          }
        });

        marker.on('dragend', () => {
          const newBounds = rectangle.getBounds();
          isUpdatingFromDragRef.current = true;
          onChange({
            bbox_west: newBounds.getWest(),
            bbox_south: newBounds.getSouth(),
            bbox_east: newBounds.getEast(),
            bbox_north: newBounds.getNorth(),
          });
        });

        return marker;
      };

      markersRef.current.nw = createMarker(bbox_north, bbox_west, true);
      markersRef.current.se = createMarker(bbox_south, bbox_east, false);
    }

    // Only re-fit the map when coordinates actually changed (not on re-renders)
    if (bboxActuallyChanged) {
      mapRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [value, value.bbox_west, value.bbox_south, value.bbox_east, value.bbox_north, onChange]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-neutral-700 mb-1">Bounding Box</h3>
        <p className="text-xs text-neutral-500">
          The geographic area where imagery can be loaded for this campaign. Search for a country or
          region, or set coordinates manually.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Search + Coordinate Inputs */}
        <div className="lg:col-span-1 space-y-4">
          {/* Country / Region Search */}
          <div className="relative" ref={searchRef}>
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
                  placeholder="Search country or region..."
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
                <div className="absolute bottom-full right-0 mb-1.5 w-56 px-2.5 py-2 bg-neutral-800 text-white text-[11px] leading-relaxed rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 pointer-events-none z-50">
                  Country bounding boxes were AI-generated as a quick prototype. They may not
                  reflect actual boundaries and do not represent any geopolitical positions of the
                  authors.
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
                No results found
              </div>
            )}
          </div>

          {/* Coordinate Inputs */}
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-xs text-neutral-700">West (Long)</span>
              <input
                type="number"
                step="any"
                value={value.bbox_west}
                onChange={(e) => onChange({ bbox_west: Number(e.target.value) })}
                className="w-full border-b border-brand-600 focus:border-b-2 outline-none focus:ring-0"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-neutral-700">South (Lat)</span>
              <input
                type="number"
                step="any"
                value={value.bbox_south}
                onChange={(e) => onChange({ bbox_south: Number(e.target.value) })}
                className="w-full border-b border-brand-600 focus:border-b-2 outline-none focus:ring-0"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-neutral-700">East (Long)</span>
              <input
                type="number"
                step="any"
                value={value.bbox_east}
                onChange={(e) => onChange({ bbox_east: Number(e.target.value) })}
                className="w-full border-b border-brand-600 focus:border-b-2 outline-none focus:ring-0"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-neutral-700">North (Lat)</span>
              <input
                type="number"
                step="any"
                value={value.bbox_north}
                onChange={(e) => onChange({ bbox_north: Number(e.target.value) })}
                className="w-full border-b border-brand-600 focus:border-b-2 outline-none focus:ring-0"
              />
            </label>

            <div className="col-span-2 text-xs text-neutral-500 mt-1">
              Drag the corner handles to resize, or drag the box to move it
            </div>
          </div>
        </div>

        {/* Map */}
        <div className="lg:col-span-2">
          <div ref={containerRef} className="w-full h-64 rounded-lg border border-neutral-200" />
        </div>
      </div>

      <style>{`
        .bbox-corner-marker {
          background: transparent !important;
          border: none !important;
        }
      `}</style>
    </div>
  );
};
