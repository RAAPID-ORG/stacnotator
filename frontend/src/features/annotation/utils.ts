import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { Icon, Style } from 'ol/style';
import { fromLonLat } from 'ol/proj';

const buildCrosshairLayer = (color: string, lat: number, lon: number): VectorLayer<VectorSource> => {
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
            <line x1="0" y1="10" x2="20" y2="10" stroke="#${color}" stroke-width="1.5"/>
            <line x1="10" y1="0" x2="10" y2="20" stroke="#${color}" stroke-width="1.5"/>
        </svg>
    `;

    const feature = new Feature({
        geometry: new Point(fromLonLat([lon, lat])),
    });

    feature.setStyle(
        new Style({
            image: new Icon({
                src: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg),
                anchor: [0.5, 0.5],
                anchorXUnits: 'fraction',
                anchorYUnits: 'fraction',
                scale: 1,
            }),
        })
    );

    return new VectorLayer({
        source: new VectorSource({ features: [feature] }),
    });
}

export { buildCrosshairLayer };