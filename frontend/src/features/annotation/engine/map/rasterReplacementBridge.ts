import type OLMap from 'ol/Map';
import type BaseLayer from 'ol/layer/Base';
import TileLayer from 'ol/layer/Tile';
import type XYZ from 'ol/source/XYZ';
import { unByKey } from 'ol/Observable';
import type { EventsKey } from 'ol/events';
import type { LayerId } from './types';

export interface RasterReplacementBridge {
  /** Keep `outgoing` visible until `replacement` has painted its current
   * viewport. Without a replacement, retire immediately. */
  retire(layerId: LayerId, outgoing: BaseLayer, replacement?: BaseLayer): void;
  dispose(): void;
}

/**
 * Owns the one intentional overlap between cached imagery dates. Readiness is
 * tracked on the replacement source/layer itself; unrelated map layers cannot
 * delay the handoff. Camera movement cancels it synchronously so the retained
 * date never requests tiles for the new viewport.
 */
export function createRasterReplacementBridge(
  map: OLMap,
  isRetained: (layerId: LayerId, layer: BaseLayer) => boolean,
  timeoutMs = 3000
): RasterReplacementBridge {
  let pendingCleanup: ((hide: boolean) => void) | null = null;

  const cancel = () => pendingCleanup?.(true);
  const moveKey = map.on('movestart', cancel);

  return {
    retire(layerId, outgoing, replacement) {
      cancel();
      if (!replacement) {
        if (isRetained(layerId, outgoing)) outgoing.setVisible(false);
        return;
      }

      const source = (replacement as TileLayer<XYZ>).getSource?.();
      if (!source) {
        if (isRetained(layerId, outgoing)) outgoing.setVisible(false);
        return;
      }

      let inflight = 0;
      let hasPainted = false;
      let settled = false;
      const keys: EventsKey[] = [];
      const replacementEvents = replacement as unknown as {
        once(type: 'postrender', listener: () => void): EventsKey;
      };

      const cleanup = (hide: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unByKey(keys);
        if (pendingCleanup === cleanup) pendingCleanup = null;
        if (hide && isRetained(layerId, outgoing)) {
          outgoing.setVisible(false);
          map.render();
        }
      };
      const finishAfterPaint = () => {
        if (!settled && hasPainted && inflight === 0) cleanup(true);
      };
      const recordPaint = () => {
        const size = map.getSize();
        if (size) {
          const pixel = [Math.floor(size[0] / 2), Math.floor(size[1] / 2)];
          hasPainted = (replacement as TileLayer<XYZ>).getData(pixel) !== null;
        }
        finishAfterPaint();
      };

      const timer = setTimeout(() => cleanup(true), timeoutMs);
      keys.push(
        source.on('tileloadstart', () => {
          inflight++;
        }),
        ...source.on(['tileloadend', 'tileloaderror'], () => {
          inflight = Math.max(0, inflight - 1);
          if (inflight === 0) {
            keys.push(replacementEvents.once('postrender', recordPaint));
            map.render();
          }
        }),
        replacementEvents.once('postrender', recordPaint)
      );

      pendingCleanup = cleanup;
      map.render();
    },

    dispose() {
      cancel();
      unByKey(moveKey);
    },
  };
}
