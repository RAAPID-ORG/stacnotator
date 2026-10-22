import { create } from 'zustand';
import type { Bbox } from '~/shared/map/types';
import type { SegmentationModelId } from '~/shared/segmentation/models';
import type { Backend } from '~/shared/segmentation/protocol';

/** One outline the wand found, awaiting the user's yes or no. */
export interface Proposal {
  id: string;
  labelId: number;
  geometry: GeoJSON.Polygon;
  score: number;
  /** Whether accepting saves it. Starts true; a click on the map flips it. */
  accepted: boolean;
}

/** `object` outlines the one thing in the box; `all` finds every match of the
 *  label's prompt inside it. */
export type WandMode = 'object' | 'all';

export type WandStatus =
  | { phase: 'idle' }
  | { phase: 'downloading'; model: SegmentationModelId; loaded: number; total: number }
  | { phase: 'fetching' }
  | { phase: 'segmenting' }
  | { phase: 'error'; message: string };

/** The click-grown outline grow and shrink act on: which proposal it is, and
 *  where it sits among the stops its flood found. */
export interface Growth {
  proposalId: string;
  index: number;
  stops: number;
}

export interface WandRun {
  found: number;
  millis: number;
  metresPerPixel: number;
  /** Dates whose edges went into a click-grown outline. */
  dates?: number;
}

interface WandState {
  mode: WandMode;
  status: WandStatus;
  /** The box being segmented, until its answer arrives. */
  area: Bbox | null;
  proposals: Proposal[];
  backend: Backend | null;
  lastRun: WandRun | null;
  growth: Growth | null;
  /** Average edges over several dates of the source before growing - the
   *  classic way to separate fields one date shows as alike. */
  multiDate: boolean;

  setMode: (mode: WandMode) => void;
  setStatus: (status: WandStatus) => void;
  setBackend: (backend: Backend) => void;
  begin: (area: Bbox) => void;
  finish: (proposals: Proposal[], run: WandRun) => void;
  fail: (message: string) => void;
  toggle: (id: string) => void;
  setGrowth: (growth: Growth | null) => void;
  reshape: (id: string, geometry: GeoJSON.Polygon) => void;
  setMultiDate: (multiDate: boolean) => void;
  /** Drops the proposals; a run in flight still lands. */
  discard: () => void;
  reset: () => void;
}

const initial = {
  mode: 'object' as WandMode,
  status: { phase: 'idle' } as WandStatus,
  area: null,
  proposals: [],
  lastRun: null,
  growth: null,
  multiDate: false,
};

export const useWandStore = create<WandState>()((set) => ({
  ...initial,
  backend: null,

  setMode: (mode) => set({ mode }),
  setStatus: (status) => set({ status }),
  setBackend: (backend) => set({ backend }),
  begin: (area) => set({ area, status: { phase: 'fetching' } }),
  // A second box adds to what is waiting rather than replacing it: going
  // object by object and then accepting the lot is the common rhythm.
  finish: (proposals, run) =>
    set((s) => ({
      area: null,
      status: { phase: 'idle' },
      proposals: [...s.proposals, ...proposals],
      lastRun: run,
    })),
  fail: (message) => set({ area: null, status: { phase: 'error', message } }),
  toggle: (id) =>
    set((s) => ({
      proposals: s.proposals.map((p) => (p.id === id ? { ...p, accepted: !p.accepted } : p)),
    })),
  setGrowth: (growth) => set({ growth }),
  reshape: (id, geometry) =>
    set((s) => ({ proposals: s.proposals.map((p) => (p.id === id ? { ...p, geometry } : p)) })),
  setMultiDate: (multiDate) => set({ multiDate }),
  discard: () => set({ proposals: [], growth: null }),
  // The backend is a property of this browser, not of the campaign.
  reset: () => set(initial),
}));

export const isWandBusy = (status: WandStatus): boolean =>
  status.phase === 'downloading' || status.phase === 'fetching' || status.phase === 'segmenting';
