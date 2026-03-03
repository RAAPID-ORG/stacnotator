import { createContext, useContext } from 'react';
import type { SliceLayerMap } from '../hooks/useStacAllSlices';

/**
 * Context that carries the fully-resolved SliceLayerMap for the current
 * imagery. Populated by AnnotationPage (before Canvas renders) and consumed
 * by TaskModeMap and ImageryContainer.
 */
export interface SliceLayerMapContextValue {
  /** Map from `{windowId}-{sliceIndex}` -> array of resolved tile URLs per viz template */
  sliceLayerMap: SliceLayerMap;
  /** Total registrations required */
  totalSlices: number;
  /** How many have been resolved so far */
  registeredSlices: number;
}

const SliceLayerMapContext = createContext<SliceLayerMapContextValue>({
  sliceLayerMap: new Map(),
  totalSlices: 0,
  registeredSlices: 0,
});

export const SliceLayerMapProvider = SliceLayerMapContext.Provider;

/** Hook - throws if used outside the provider */
export function useSliceLayerMap(): SliceLayerMapContextValue {
  return useContext(SliceLayerMapContext);
}
