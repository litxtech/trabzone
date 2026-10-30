import { create } from 'zustand';

import type { EarthquakeOrder, EarthquakeRegion, EarthquakeSourceFilter } from './types';
import type { MagnitudeBucket, RangePreset } from './utils/scale';

type EarthquakeFilterState = {
  /** null: sunucunun varsayılan bölgesi (bootstrap) kullanılır. */
  region: EarthquakeRegion | null;
  district: string | null;
  range: RangePreset;
  customFrom: string | null;
  customTo: string | null;
  bucket: MagnitudeBucket;
  source: EarthquakeSourceFilter;
  order: EarthquakeOrder;
  selectedId: string | null;
  setRegion: (region: EarthquakeRegion) => void;
  setDistrict: (district: string | null) => void;
  setRange: (range: RangePreset, from?: string | null, to?: string | null) => void;
  setBucket: (bucket: MagnitudeBucket) => void;
  setSource: (source: EarthquakeSourceFilter) => void;
  setOrder: (order: EarthquakeOrder) => void;
  select: (id: string | null) => void;
  reset: () => void;
};

const initial = {
  region: null,
  district: null,
  range: '7d' as RangePreset,
  customFrom: null,
  customTo: null,
  bucket: 'all' as MagnitudeBucket,
  source: 'all' as EarthquakeSourceFilter,
  order: 'newest' as EarthquakeOrder,
  selectedId: null,
};

/** Ana ekran, harita, liste ve analiz aynı filtreyi paylaşır. */
export const useEarthquakeFilterStore = create<EarthquakeFilterState>()((set) => ({
  ...initial,
  setRegion: (region) => set({ region, district: null, selectedId: null }),
  setDistrict: (district) =>
    set((state) => ({ district, region: district ? 'province' : state.region, selectedId: null })),
  setRange: (range, from = null, to = null) => set({ range, customFrom: from, customTo: to, selectedId: null }),
  setBucket: (bucket) => set({ bucket, selectedId: null }),
  setSource: (source) => set({ source, selectedId: null }),
  setOrder: (order) => set({ order }),
  select: (selectedId) => set({ selectedId }),
  reset: () => set(initial),
}));
