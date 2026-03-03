import { useEffect, useRef, memo } from "react";
import OLMap from "ol/Map";
import View from "ol/View";
import { fromLonLat } from "ol/proj";
import "ol/ol.css";


interface MapProps {
  onMapReady?: (map: OLMap) => void;
  center?: [number, number];
  zoom?: number;
}

const Map = ({
  onMapReady,
  center = [0, 0],
  zoom = 10,
}: MapProps) => {
  const mapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    const map = new OLMap({
      target: mapRef.current,
      layers: [],
      maxTilesLoading: 64,  // default is 16 - more concurrent tile requests fills the viewport faster
      view: new View({
        // center is [lat, lon] in degrees - convert to Web Mercator [lon, lat]
        center: fromLonLat([center[1], center[0]]),
        zoom,
      }),
    });

    onMapReady?.(map);

    return () => {
      map.setTarget(undefined);
    };
  // onMapReady is intentionally excluded - it's a one-time setup callback
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full h-full min-h-[400px]">
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
};

export default memo(Map);