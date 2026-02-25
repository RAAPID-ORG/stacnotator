import { useEffect, useRef } from "react";
import OLMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import "ol/ol.css";


const esriImagery = new TileLayer({
  source: new XYZ({
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attributions: 'Tiles © Esri'
  })
});

const openTopoMap = new TileLayer({
  source: new XYZ({
    url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attributions: '© OpenTopoMap contributors'
  })
});


interface MapProps {
  onMapReady?: (map: OLMap) => void;
  layers?: TileLayer<XYZ>[];
  center?: [number, number];
  zoom?: number;
}

const Map = ({
  onMapReady,
  layers,
  center = [0, 0],
  zoom = 10,
}: MapProps) => {
  const mapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    const map = new OLMap({
      target: mapRef.current,
      layers: layers ?? [esriImagery, openTopoMap],
      view: new View({
        center,
        zoom,
      }),
    });

    onMapReady?.(map);

    return () => {
      map.setTarget(undefined);
    };
  }, [onMapReady, layers, center[0], center[1], zoom]);

  return (
    <div className="w-full h-full min-h-[400px]">
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
};

export default Map;