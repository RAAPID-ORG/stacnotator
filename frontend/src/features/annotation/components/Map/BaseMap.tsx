import { useEffect, useRef, memo } from "react";
import OLMap from "ol/Map";
import View from "ol/View";
import { fromLonLat } from "ol/proj";
import ScaleLine from "ol/control/ScaleLine";
import "ol/ol.css";


interface MapProps {
  onMapReady?: (map: OLMap) => void;
  center?: [number, number];
  zoom?: number;
}

const BaseMap = ({
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
      maxTilesLoading: 64,
      controls: [
        new ScaleLine({
          units: 'metric',
        }),
      ],
      view: new View({
        // center is [lat, lon] in degrees - convert to Web Mercator [lon, lat]
        center: fromLonLat([center[1], center[0]]),
        zoom,
        maxZoom: 24,  // allow zooming past basemap tile limits (tiles will stretch)
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

export default memo(BaseMap);
