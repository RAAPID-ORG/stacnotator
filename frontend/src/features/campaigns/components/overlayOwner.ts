import {
  createCustomMap,
  createVectorLayer,
  createVisualizerCustomMap,
  createVisualizerVectorLayer,
  deleteCustomMap,
  deleteVectorLayer,
  deleteVisualizerCustomMap,
  deleteVisualizerVectorLayer,
  listCustomMaps,
  listVectorLayers,
  listVisualizerCustomMaps,
  listVisualizerVectorLayers,
  updateCustomMap,
  updateVectorLayer,
  updateVisualizerCustomMap,
  updateVisualizerVectorLayer,
  type CustomMapCreate,
  type CustomMapUpdate,
  type VectorLayerCreate,
  type VectorLayerUpdate,
} from '~/api/client';

/**
 * Overlays belong to a campaign or to a visualizer, and the editors are the
 * same either way. This is the one place that knows which endpoints an owner
 * uses, so the editors themselves never have to.
 */
export type OverlayOwnerKind = 'campaign' | 'visualizer';

export const customMapApi = (kind: OverlayOwnerKind, id: number) =>
  kind === 'campaign'
    ? {
        list: () => listCustomMaps({ path: { campaign_id: id } }),
        create: (body: CustomMapCreate) => createCustomMap({ path: { campaign_id: id }, body }),
        update: (mapId: number, body: CustomMapUpdate) =>
          updateCustomMap({ path: { campaign_id: id, map_id: mapId }, body }),
        remove: (mapId: number) => deleteCustomMap({ path: { campaign_id: id, map_id: mapId } }),
      }
    : {
        list: () => listVisualizerCustomMaps({ path: { visualizer_id: id } }),
        create: (body: CustomMapCreate) =>
          createVisualizerCustomMap({ path: { visualizer_id: id }, body }),
        update: (mapId: number, body: CustomMapUpdate) =>
          updateVisualizerCustomMap({ path: { visualizer_id: id, map_id: mapId }, body }),
        remove: (mapId: number) =>
          deleteVisualizerCustomMap({ path: { visualizer_id: id, map_id: mapId } }),
      };

export const vectorLayerApi = (kind: OverlayOwnerKind, id: number) =>
  kind === 'campaign'
    ? {
        list: () => listVectorLayers({ path: { campaign_id: id } }),
        create: (body: VectorLayerCreate) => createVectorLayer({ path: { campaign_id: id }, body }),
        update: (layerId: number, body: VectorLayerUpdate) =>
          updateVectorLayer({ path: { campaign_id: id, layer_id: layerId }, body }),
        remove: (layerId: number) =>
          deleteVectorLayer({ path: { campaign_id: id, layer_id: layerId } }),
      }
    : {
        list: () => listVisualizerVectorLayers({ path: { visualizer_id: id } }),
        create: (body: VectorLayerCreate) =>
          createVisualizerVectorLayer({ path: { visualizer_id: id }, body }),
        update: (layerId: number, body: VectorLayerUpdate) =>
          updateVisualizerVectorLayer({
            path: { visualizer_id: id, layer_id: layerId },
            body,
          }),
        remove: (layerId: number) =>
          deleteVisualizerVectorLayer({ path: { visualizer_id: id, layer_id: layerId } }),
      };
