import { useEffect, useRef, memo } from 'react';
import OLMap from 'ol/Map';
import View from 'ol/View';
import { fromLonLat } from 'ol/proj';
import ScaleLine from 'ol/control/ScaleLine';
import Attribution from 'ol/control/Attribution';
import { defaults as defaultInteractions, MouseWheelZoom, DragPan } from 'ol/interaction';
import Kinetic from 'ol/Kinetic';
import 'ol/ol.css';

interface MapProps {
  onMapReady?: (map: OLMap) => void;
  center?: [number, number];
  zoom?: number;
}

const BaseMap = ({ onMapReady, center = [0, 0], zoom = 10 }: MapProps) => {
  const mapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    const map = new OLMap({
      target: mapRef.current,
      layers: [],
      maxTilesLoading: 64,
      controls: [
        new ScaleLine({
          units: 'metric',
        }),
        new Attribution({
          collapsible: true,
          collapsed: true,
        }),
      ],
      interactions: defaultInteractions({ mouseWheelZoom: false, dragPan: false }).extend([
        // Snappier wheel zoom - default duration is 250ms, which feels sluggish.
        new MouseWheelZoom({ duration: 150, timeout: 50 }),
        // Softer kinetic decay (-0.003 vs OL default -0.005) gives a longer,
        // smoother glide when releasing a drag-pan.
        new DragPan({ kinetic: new Kinetic(-0.003, 0.05, 100) }),
      ]),
      view: new View({
        // center is [lat, lon] in degrees - convert to Web Mercator [lon, lat]
        center: fromLonLat([center[1], center[0]]),
        zoom,
        maxZoom: 24, // allow zooming past basemap tile limits (tiles will stretch)
      }),
    });

    onMapReady?.(map);

    return () => {
      // Clear all tile sources to abort in-flight tile requests
      map.getLayers().forEach((layer) => {
        if ('setSource' in layer && typeof layer.setSource === 'function') {
          (layer as unknown as { setSource: (s: null) => void }).setSource(null);
        }
      });
      map.setTarget(undefined);
    };
    // onMapReady is intentionally excluded - it's a one-time setup callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full h-full">
      <div ref={mapRef} className="w-full h-full bg-neutral-200" />
    </div>
  );
};

export default memo(BaseMap);
