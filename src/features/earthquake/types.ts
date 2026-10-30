export type EarthquakeRegion = 'province' | 'r50' | 'r100' | 'r150' | 'r250' | 'turkey';
export type EarthquakeSource = 'afad' | 'usgs';
export type EarthquakeSourceFilter = 'all' | EarthquakeSource;
export type EarthquakeOrder = 'newest' | 'oldest' | 'largest' | 'nearest';
export type RegionClassification =
  | 'trabzon_province'
  | 'trabzon_offshore'
  | 'trabzon_vicinity'
  | 'turkey'
  | 'outside';

/** Veri durumu: "live" yalnızca birincil kaynak yakın zamanda okunduysa gelir. */
export type EarthquakeDataState = 'live' | 'fallback' | 'delayed' | 'unavailable';

export type EarthquakeStatus = {
  state: EarthquakeDataState;
  primary_source: EarthquakeSource | null;
  primary_last_success_at: string | null;
  last_success_at: string | null;
  stale_after_seconds: number;
  sync_interval_seconds: number;
  checked_at: string;
};

export type EarthquakeEvent = {
  id: string;
  occurred_at: string;
  latitude: number;
  longitude: number;
  depth_km: number | null;
  magnitude: number;
  magnitude_type: string | null;
  location: string | null;
  distance_km: number;
  in_province: boolean;
  district_key: string | null;
  district_name: string | null;
  region_classification: RegionClassification;
  source: EarthquakeSource;
  sources: EarthquakeSource[];
  revision: number;
  updated_at: string;
  first_seen_at: string;
};

export type EarthquakeSourceInfo = {
  key: EarthquakeSource;
  name: string;
  homepage_url: string;
  attribution: string;
  is_enabled: boolean;
  is_primary: boolean;
  health: 'unknown' | 'healthy' | 'degraded' | 'down' | 'disabled';
  last_success_at: string | null;
  last_attempt_at: string | null;
};

export type EarthquakeBootstrap = {
  settings: {
    center: { lat: number; lng: number; label: string };
    default_region: EarthquakeRegion;
    radius_options: number[];
    turkey_enabled: boolean;
    district_filter_enabled: boolean;
    default_range_days: number;
    map_default_zoom: number;
    map_layers: { boundary?: boolean; radius?: boolean; clusters?: boolean };
    chart_max_points: number;
  };
  districts: { key: string; name: string }[];
  /** [enlem, boylam] çiftleri. */
  province_ring: [number, number][] | null;
  boundary_attribution: string;
  sources: EarthquakeSourceInfo[];
  coverage: { afad_since: string | null; usgs_since: string | null; archive_since: string | null };
  status: EarthquakeStatus;
};

export type EarthquakeOverview = {
  region: EarthquakeRegion;
  district: string | null;
  from: string;
  to: string;
  count_24h: number;
  count_range: number;
  max_event: EarthquakeEvent | null;
  latest_event: EarthquakeEvent | null;
  status: EarthquakeStatus;
};

export type EarthquakeFeedPage = {
  items: EarthquakeEvent[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  region: EarthquakeRegion;
};

/** Harita noktası (sunucudan sıkıştırılmış dizi olarak gelir). */
export type EarthquakePoint = {
  id: string;
  lat: number;
  lng: number;
  magnitude: number;
  magnitudeType: string | null;
  occurredAt: string;
  depthKm: number | null;
  source: EarthquakeSource;
  location: string | null;
  distanceKm: number;
};

export type EarthquakeMapData = {
  points: EarthquakePoint[];
  total: number;
  truncated: boolean;
};

export type EarthquakeBin = { key: string; label: string; count: number };

export type EarthquakeAnalytics = {
  region: EarthquakeRegion;
  from: string;
  to: string;
  bucket: 'hour' | 'day' | 'week';
  total: number;
  series: { t: string; count: number; max_magnitude: number | null }[];
  magnitude_bins: EarthquakeBin[];
  depth_bins: EarthquakeBin[];
  unknown_depth: number;
  points: { id: string; occurredAt: string; magnitude: number; depthKm: number | null; magnitudeType: string | null }[];
  points_truncated: boolean;
  grid_cell_deg: number;
  grid: { lat: number; lng: number; count: number; max_magnitude: number }[];
};

export type EarthquakeSourceRecord = {
  source: EarthquakeSource;
  source_event_id: string;
  magnitude: number;
  magnitude_type: string | null;
  depth_km: number | null;
  latitude: number;
  longitude: number;
  occurred_at: string;
  location: string | null;
  status: string | null;
  source_updated_at: string | null;
  url: string | null;
  revision: number;
  match_method: 'origin' | 'auto' | 'admin';
  match_distance_km: number | null;
  match_dt_seconds: number | null;
  last_fetched_at: string;
};

export type EarthquakeRevision = {
  source: EarthquakeSource | null;
  revision: number;
  kind: 'source_update' | 'preferred_source';
  changes: Record<string, { old: unknown; new: unknown }>;
  significant: boolean;
  created_at: string;
};

export type EarthquakeDetail = EarthquakeEvent & {
  requested_key: string;
  status: 'active' | 'pending_match';
  source_updated_at: string | null;
  source_province: string | null;
  source_district: string | null;
  records: EarthquakeSourceRecord[];
  revisions: EarthquakeRevision[];
  attribution: string | null;
};

export type EarthquakeFilters = {
  region: EarthquakeRegion;
  district: string | null;
  from: string | null;
  to: string | null;
  minMagnitude: number | null;
  maxMagnitude: number | null;
  minDepth?: number | null;
  maxDepth?: number | null;
  source: EarthquakeSourceFilter;
};

export type EarthquakePrefs = {
  saved: boolean;
  notifications_enabled: boolean;
  region_mode: 'trabzon' | 'province' | 'turkey';
  radius_km: 50 | 100 | 150 | 250;
  notify_all_magnitudes: boolean;
  minimum_magnitude: 1 | 2 | 3 | 4 | 5;
  sound_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_start_hour: number;
  quiet_end_hour: number;
  preference_updated_at: string | null;
  system: {
    notifications_enabled: boolean;
    paused: boolean;
    trabzon_enabled: boolean;
    turkey_enabled: boolean;
    small_enabled: boolean;
    small_threshold: number;
    quiet_bypass_magnitude: number;
  };
  devices: { platform: string; app_version: string | null; last_seen_at: string | null }[];
};

export type EarthquakePrefsInput = Omit<EarthquakePrefs, 'saved' | 'preference_updated_at' | 'system' | 'devices'>;

export type EarthquakeHistoryItem = {
  id: string;
  type: 'new' | 'revision' | 'test';
  title: string | null;
  body: string | null;
  route: string | null;
  event_id: string | null;
  magnitude: number | null;
  magnitude_type: string | null;
  occurred_at: string | null;
  created_at: string;
  read_at: string | null;
  push: { devices: number; sent: number; suppressed: number; failed: number; pending: number } | null;
};
