import { describe, it, expect, vi } from 'vitest';
import OLMap from 'ol/Map';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import Draw, { DrawEvent } from 'ol/interaction/Draw';
import Modify, { ModifyEvent } from 'ol/interaction/Modify';
import Translate, { TranslateEvent } from 'ol/interaction/Translate';
import DragBox, { DragBoxEvent } from 'ol/interaction/DragBox';
import Snap from 'ol/interaction/Snap';
import Collection from 'ol/Collection';
import { attachInteractions, configsEqual, toGeo, fromGeo, type SketchLayer } from './attach';
import { LAYER_ID_PROP } from '../olLayerFactory';
import type { InteractionSpec } from './types';
import type { GeoFeature } from '../types';

// jsdom has no ResizeObserver; ol/Map's constructor uses one regardless of
// whether the map has a target, so tests that construct a map need this
// stubbed out.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

function makeSketchLayer(): SketchLayer {
  return new VectorLayer({ source: new VectorSource() });
}

describe('toGeo / fromGeo round trip', () => {
  it('preserves a point through 4326 -> 3857 -> 4326', () => {
    const geometry: GeoJSON.Point = { type: 'Point', coordinates: [12.5, 41.9] };
    const ol = fromGeo(geometry);
    const back = toGeo(ol) as GeoJSON.Point;
    expect(back.coordinates[0]).toBeCloseTo(12.5, 9);
    expect(back.coordinates[1]).toBeCloseTo(41.9, 9);
  });

  it('preserves a polygon ring through the round trip', () => {
    const geometry: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-3, 50],
          [-2, 50],
          [-2, 51],
          [-3, 51],
          [-3, 50],
        ],
      ],
    };
    const back = toGeo(fromGeo(geometry)) as GeoJSON.Polygon;
    geometry.coordinates[0].forEach((coord, i) => {
      expect(back.coordinates[0][i][0]).toBeCloseTo(coord[0], 9);
      expect(back.coordinates[0][i][1]).toBeCloseTo(coord[1], 9);
    });
  });
});

describe('configsEqual', () => {
  const feature: GeoFeature = { id: 1, geometry: { type: 'Point', coordinates: [0, 0] } };
  const onDrawEnd = vi.fn();
  const onGeometryChange = vi.fn();
  const onBox = vi.fn();

  it('treats undefined specs as equal', () => {
    expect(configsEqual(undefined, undefined)).toBe(true);
  });

  it('treats a spec against undefined as different', () => {
    expect(configsEqual({ snap: true }, undefined)).toBe(false);
  });

  it('is content-equal across two distinct objects with the same fields', () => {
    const a: InteractionSpec = { draw: { shape: 'Point', onDrawEnd }, snap: true };
    const b: InteractionSpec = { draw: { shape: 'Point', onDrawEnd }, snap: true };
    expect(configsEqual(a, b)).toBe(true);
  });

  it('differs when the draw shape changes', () => {
    const a: InteractionSpec = { draw: { shape: 'Point', onDrawEnd } };
    const b: InteractionSpec = { draw: { shape: 'Polygon', onDrawEnd } };
    expect(configsEqual(a, b)).toBe(false);
  });

  it('ignores draw/edit/boxSelect callback identity - only config matters', () => {
    const a: InteractionSpec = { draw: { shape: 'Point', onDrawEnd } };
    const b: InteractionSpec = { draw: { shape: 'Point', onDrawEnd: vi.fn() } };
    expect(configsEqual(a, b)).toBe(true);

    const c: InteractionSpec = { edit: { feature, onGeometryChange } };
    const d: InteractionSpec = { edit: { feature, onGeometryChange: vi.fn() } };
    expect(configsEqual(c, d)).toBe(true);

    const e: InteractionSpec = { boxSelect: { onBox } };
    const f: InteractionSpec = { boxSelect: { onBox: vi.fn() } };
    expect(configsEqual(e, f)).toBe(true);
  });

  it('differs when the edit feature geometry changes', () => {
    const a: InteractionSpec = { edit: { feature, onGeometryChange } };
    const b: InteractionSpec = {
      edit: {
        feature: { ...feature, geometry: { type: 'Point', coordinates: [1, 1] } },
        onGeometryChange,
      },
    };
    expect(configsEqual(a, b)).toBe(false);
  });

  it('differs when boxSelect appears or disappears', () => {
    const a: InteractionSpec = { snap: false };
    const b: InteractionSpec = { boxSelect: { onBox }, snap: false };
    expect(configsEqual(a, b)).toBe(false);
  });

  it('differs when the snap flag changes', () => {
    expect(configsEqual({ snap: true }, { snap: false })).toBe(false);
  });
});

describe('attachInteractions', () => {
  it('adds a Draw interaction for a draw spec and nothing else', () => {
    const map = new OLMap({ interactions: [] });
    const sketchLayer = makeSketchLayer();
    attachInteractions(map, { draw: { shape: 'Point', onDrawEnd: vi.fn() } }, sketchLayer);

    const kinds = map.getInteractions().getArray();
    expect(kinds.filter((i) => i instanceof Draw)).toHaveLength(1);
    expect(kinds.filter((i) => i instanceof Modify)).toHaveLength(0);
    expect(kinds.filter((i) => i instanceof DragBox)).toHaveLength(0);
    expect(kinds.filter((i) => i instanceof Snap)).toHaveLength(0);
  });

  it('leaves interactions untouched when called again with an equal spec', () => {
    const map = new OLMap({ interactions: [] });
    const sketchLayer = makeSketchLayer();
    const onDrawEnd = vi.fn();

    attachInteractions(map, { draw: { shape: 'Point', onDrawEnd } }, sketchLayer);
    const first = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof Draw);

    attachInteractions(map, { draw: { shape: 'Point', onDrawEnd } }, sketchLayer);
    const second = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof Draw);

    expect(second).toBe(first);
    expect(
      map
        .getInteractions()
        .getArray()
        .filter((i) => i instanceof Draw)
    ).toHaveLength(1);
  });

  it('does not tear down a live sketch when only callback identity changes, and invokes the new callback', () => {
    const map = new OLMap({ interactions: [] });
    const sketchLayer = makeSketchLayer();
    const onDrawEndA = vi.fn();
    attachInteractions(map, { draw: { shape: 'Point', onDrawEnd: onDrawEndA } }, sketchLayer);
    const draw = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof Draw) as Draw;

    // Start a sketch (mirrors a user mid-draw when the parent re-renders).
    draw.dispatchEvent(new DrawEvent('drawstart', new Feature()));

    // Re-attach with structurally-equal config but a fresh, un-memoized
    // callback - the shape React re-renders naturally produce.
    const onDrawEndB = vi.fn();
    attachInteractions(map, { draw: { shape: 'Point', onDrawEnd: onDrawEndB } }, sketchLayer);

    // Same Draw instance survives: no teardown/rebuild, so the in-progress
    // sketch (and drawing state) is untouched.
    const drawAfter = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof Draw) as Draw;
    expect(drawAfter).toBe(draw);

    const coord = fromLonLat([3, 4]);
    const feature = new Feature({ geometry: new Point(coord) });
    sketchLayer.getSource()!.addFeature(feature);
    draw.dispatchEvent(new DrawEvent('drawend', feature));

    expect(onDrawEndA).not.toHaveBeenCalled();
    expect(onDrawEndB).toHaveBeenCalledTimes(1);
    const geometry = onDrawEndB.mock.calls[0][0] as GeoJSON.Point;
    expect(geometry.coordinates[0]).toBeCloseTo(3, 6);
    expect(geometry.coordinates[1]).toBeCloseTo(4, 6);
  });

  it('swaps the Draw interaction when the spec changes', () => {
    const map = new OLMap({ interactions: [] });
    const sketchLayer = makeSketchLayer();
    attachInteractions(map, { draw: { shape: 'Point', onDrawEnd: vi.fn() } }, sketchLayer);
    const first = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof Draw);

    attachInteractions(map, { draw: { shape: 'Polygon', onDrawEnd: vi.fn() } }, sketchLayer);
    const draws = map
      .getInteractions()
      .getArray()
      .filter((i) => i instanceof Draw);

    expect(draws).toHaveLength(1);
    expect(draws[0]).not.toBe(first);
  });

  it('removes everything when the spec becomes undefined', () => {
    const map = new OLMap({ interactions: [] });
    const sketchLayer = makeSketchLayer();
    attachInteractions(map, { draw: { shape: 'Point', onDrawEnd: vi.fn() } }, sketchLayer);
    expect(map.getInteractions().getArray().length).toBeGreaterThan(0);

    attachInteractions(map, undefined, sketchLayer);
    expect(map.getInteractions().getArray()).toHaveLength(0);
  });

  it('fires onDrawEnd with 4326 geometry and clears the sketch feature', () => {
    const map = new OLMap({ interactions: [] });
    const sketchLayer = makeSketchLayer();
    const onDrawEnd = vi.fn();
    attachInteractions(map, { draw: { shape: 'Point', onDrawEnd } }, sketchLayer);
    const draw = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof Draw) as Draw;

    const coord = fromLonLat([10, 20]);
    const feature = new Feature({ geometry: new Point(coord) });
    sketchLayer.getSource()!.addFeature(feature);
    draw.dispatchEvent(new DrawEvent('drawend', feature));

    expect(onDrawEnd).toHaveBeenCalledTimes(1);
    const geometry = onDrawEnd.mock.calls[0][0] as GeoJSON.Point;
    expect(geometry.coordinates[0]).toBeCloseTo(10, 6);
    expect(geometry.coordinates[1]).toBeCloseTo(20, 6);
    expect(sketchLayer.getSource()!.getFeatures()).toHaveLength(0);
  });

  it('aborts an in-progress sketch on Escape (capture phase) and leaves it alone otherwise', () => {
    const map = new OLMap({ interactions: [] });
    const sketchLayer = makeSketchLayer();
    attachInteractions(map, { draw: { shape: 'Point', onDrawEnd: vi.fn() } }, sketchLayer);
    const draw = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof Draw) as Draw;
    const abort = vi.spyOn(draw, 'abortDrawing').mockImplementation(() => {});

    // Escape before a sketch has started does nothing.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(abort).not.toHaveBeenCalled();

    draw.dispatchEvent(new DrawEvent('drawstart', new Feature()));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('seeds the edit feature into the sketch source and reports modify/translate end in 4326', () => {
    const map = new OLMap({ interactions: [] });
    const sketchLayer = makeSketchLayer();
    const onGeometryChange = vi.fn();
    const editFeature: GeoFeature = { id: 7, geometry: { type: 'Point', coordinates: [5, 6] } };
    attachInteractions(map, { edit: { feature: editFeature, onGeometryChange } }, sketchLayer);

    const seeded = sketchLayer.getSource()!.getFeatures();
    expect(seeded).toHaveLength(1);
    expect(seeded[0].getId()).toBe(7);

    const modify = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof Modify) as Modify;
    const translate = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof Translate) as Translate;
    expect(modify).toBeDefined();
    expect(translate).toBeDefined();

    // Move the seeded feature, then fire modifyend - handler reads live geometry off it.
    (seeded[0].getGeometry() as Point).setCoordinates(fromLonLat([8, 9]));
    modify.dispatchEvent(new ModifyEvent('modifyend', new Collection([seeded[0]]), {} as never));
    expect(onGeometryChange).toHaveBeenCalledTimes(1);
    let geometry = onGeometryChange.mock.calls[0][0] as GeoJSON.Point;
    expect(geometry.coordinates[0]).toBeCloseTo(8, 6);
    expect(geometry.coordinates[1]).toBeCloseTo(9, 6);
    (seeded[0].getGeometry() as Point).setCoordinates(fromLonLat([1, 2]));
    translate.dispatchEvent(
      new TranslateEvent('translateend', new Collection([seeded[0]]), [0, 0], [0, 0], {} as never)
    );
    expect(onGeometryChange).toHaveBeenCalledTimes(2);
    geometry = onGeometryChange.mock.calls[1][0] as GeoJSON.Point;
    expect(geometry.coordinates[0]).toBeCloseTo(1, 6);
    expect(geometry.coordinates[1]).toBeCloseTo(2, 6);
  });

  it('adds a DragBox for boxSelect and reports the box in lon/lat', () => {
    const map = new OLMap({ interactions: [] });
    const sketchLayer = makeSketchLayer();
    const onBox = vi.fn();
    attachInteractions(map, { boxSelect: { onBox } }, sketchLayer);
    const dragBox = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DragBox) as DragBox;

    const [x0, y0] = fromLonLat([-1, 40]);
    const [x1, y1] = fromLonLat([2, 42]);
    vi.spyOn(dragBox, 'getGeometry').mockReturnValue({
      getExtent: () => [x0, y0, x1, y1],
    } as never);

    dragBox.dispatchEvent(new DragBoxEvent('boxend', [0, 0], {} as never));

    expect(onBox).toHaveBeenCalledTimes(1);
    const bbox = onBox.mock.calls[0][0] as [number, number, number, number];
    expect(bbox[0]).toBeCloseTo(-1, 6);
    expect(bbox[1]).toBeCloseTo(40, 6);
    expect(bbox[2]).toBeCloseTo(2, 6);
    expect(bbox[3]).toBeCloseTo(42, 6);
  });

  // Labelling vector features by box needs their geometry, and nothing outside
  // this module can read a rendered vector tile - hence `hits`.
  it('reports the features of the named layers inside the box', () => {
    const map = new OLMap({ interactions: [] });
    const sketchLayer = makeSketchLayer();

    const inside = new Feature({ geometry: new Point(fromLonLat([0, 41])) });
    inside.setId('f1');
    const outside = new Feature({ geometry: new Point(fromLonLat([50, 41])) });
    const dataLayer = new VectorLayer({
      source: new VectorSource({ features: [inside, outside] }),
    });
    dataLayer.set(LAYER_ID_PROP, 'vector-1');
    const ignoredLayer = new VectorLayer({
      source: new VectorSource({
        features: [new Feature({ geometry: new Point(fromLonLat([0, 41])) })],
      }),
    });
    ignoredLayer.set(LAYER_ID_PROP, 'annotations');
    map.addLayer(dataLayer);
    map.addLayer(ignoredLayer);

    const onBox = vi.fn();
    attachInteractions(map, { boxSelect: { onBox, hitLayerIds: ['vector-1'] } }, sketchLayer);
    const dragBox = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DragBox) as DragBox;

    const [x0, y0] = fromLonLat([-1, 40]);
    const [x1, y1] = fromLonLat([2, 42]);
    vi.spyOn(dragBox, 'getGeometry').mockReturnValue({
      getExtent: () => [x0, y0, x1, y1],
    } as never);
    dragBox.dispatchEvent(new DragBoxEvent('boxend', [0, 0], {} as never));

    const hits = onBox.mock.calls[0][1] as Array<{ layerId: string; feature: GeoFeature }>;
    expect(hits).toHaveLength(1);
    expect(hits[0].layerId).toBe('vector-1');
    expect(hits[0].feature.id).toBe('f1');
    const point = hits[0].feature.geometry as GeoJSON.Point;
    expect(point.coordinates[0]).toBeCloseTo(0, 6);
    expect(point.coordinates[1]).toBeCloseTo(41, 6);
  });

  it('collects nothing when no hit layers are named', () => {
    const map = new OLMap({ interactions: [] });
    const sketchLayer = makeSketchLayer();
    const onBox = vi.fn();
    attachInteractions(map, { boxSelect: { onBox } }, sketchLayer);
    const dragBox = map
      .getInteractions()
      .getArray()
      .find((i) => i instanceof DragBox) as DragBox;
    vi.spyOn(dragBox, 'getGeometry').mockReturnValue({ getExtent: () => [0, 0, 1, 1] } as never);

    dragBox.dispatchEvent(new DragBoxEvent('boxend', [0, 0], {} as never));

    expect(onBox.mock.calls[0][1]).toEqual([]);
  });

  it('only adds Snap when requested alongside draw or edit', () => {
    const map = new OLMap({ interactions: [] });
    const sketchLayer = makeSketchLayer();
    attachInteractions(
      map,
      { draw: { shape: 'Point', onDrawEnd: vi.fn() }, snap: true },
      sketchLayer
    );
    expect(
      map
        .getInteractions()
        .getArray()
        .some((i) => i instanceof Snap)
    ).toBe(true);

    attachInteractions(map, undefined, sketchLayer);
    attachInteractions(map, { boxSelect: { onBox: vi.fn() }, snap: true }, sketchLayer);
    expect(
      map
        .getInteractions()
        .getArray()
        .some((i) => i instanceof Snap)
    ).toBe(false);
  });
});
