import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import {Icon, Style} from 'ol/style';
import {fromLonLat} from 'ol/proj';
import { LayerManager } from './layerManager';
import { useEffect, useRef } from 'react';
import Map from './Map';
import type OLMap from 'ol/Map';
import { XYZLayer } from './Layer';

const MainMap = () => {
    const mapRef = useRef<OLMap | null>(null);
    const layerManagerRef = useRef<LayerManager | null>(null);

    const buildCrosshairLayer = (color: string, lat: number, lon: number) => {
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
                <line x1="0" y1="10" x2="20" y2="10" stroke="#${color}" stroke-width="1.5"/>
                <line x1="10" y1="0" x2="10" y2="20" stroke="#${color}" stroke-width="1.5"/>
            </svg>
        `;

        const iconSrc = "data:image/svg+xml;utf8," + encodeURIComponent(svg);

        const crosshairFeature = new Feature({
            geometry: new Point(fromLonLat([lon, lat])) // lon/lat
        });

        crosshairFeature.setStyle(
        new Style({
            image: new Icon({
            src: iconSrc,
            anchor: [0.5, 0.5],
            anchorXUnits: 'fraction',
            anchorYUnits: 'fraction',
            scale: 1
            })
        })
        );

        const vectorLayer = new VectorLayer({
            source: new VectorSource({
                features: [crosshairFeature]
            })
        });

        return vectorLayer
    }

    const initLayers = () => {
        if (!layerManagerRef.current) return;

        const esriLayer = new XYZLayer({
            id: 'esri-world-imagery',
            name: 'ESRI World Imagery',
            layerType: 'imagery',
            urlTemplate: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Tiles © Esri',
        });

        const topoLayer = new XYZLayer({
            id: 'opentopomap',
            name: 'OpenTopoMap',
            layerType: 'basemap',
            urlTemplate: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
            attribution: '© OpenTopoMap contributors',
        });

        layerManagerRef.current.registerLayer(esriLayer);
        layerManagerRef.current.registerLayer(topoLayer);
        layerManagerRef.current.setActiveLayer(esriLayer.id);

        if (mapRef.current) {
            const crosshairLayer = buildCrosshairLayer('ff0000', 37.7749, -122.4194);
            mapRef.current.addLayer(crosshairLayer);
        }
    };

    useEffect(() => {
        initLayers();
    }, []);



    return (
        <Map
            onMapReady={(map) => {
                mapRef.current = map;
                layerManagerRef.current = new LayerManager(map);
                initLayers();
            }}
        />
    );
}