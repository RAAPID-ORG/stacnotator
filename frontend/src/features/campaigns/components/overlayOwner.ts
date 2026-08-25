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
import {
  listCustomMapsQueryKey,
  listVectorLayersQueryKey,
  listVisualizerCustomMapsQueryKey,
  listVisualizerVectorLayersQueryKey,
} from '~/api/queries';

/**
 * Overlays belong to a campaign or to a visualizer, and the editors are the
 * same either way. This is the one place that knows which endpoints an owner
 * uses - and which cache key its list lives under - so the editors themselves
 * never have to.
 */
export type OverlayOwnerKind = 'campaign' | 'visualizer';

export const customMapApi = (kind: OverlayOwnerKind, id: number) =>
  kind === 'campaign'
    ? {
        queryKey: listCustomMapsQueryKey({ path: { campaign_id: id } }),
        list: () => listCustomMaps({ path: { campaign_id: id } }),
        create: (body: CustomMapCreate) => createCustomMap({ path: { campaign_id: id }, body }),
        update: (mapId: number, body: CustomMapUpdate) =>
          updateCustomMap({ path: { campaign_id: id, map_id: mapId }, body }),
        remove: (mapId: number) => deleteCustomMap({ path: { campaign_id: id, map_id: mapId } }),
      }
    : {
        queryKey: listVisualizerCustomMapsQueryKey({ path: { visualizer_id: id } }),
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
        queryKey: listVectorLayersQueryKey({ path: { campaign_id: id } }),
        list: () => listVectorLayers({ path: { campaign_id: id } }),
        create: (body: VectorLayerCreate) => createVectorLayer({ path: { campaign_id: id }, body }),
        update: (layerId: number, body: VectorLayerUpdate) =>
          updateVectorLayer({ path: { campaign_id: id, layer_id: layerId }, body }),
        remove: (layerId: number) =>
          deleteVectorLayer({ path: { campaign_id: id, layer_id: layerId } }),
      }
    : {
        queryKey: listVisualizerVectorLayersQueryKey({ path: { visualizer_id: id } }),
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
