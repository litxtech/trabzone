/**
 * TRABZONE Etkileşim Haritası — paylaşılan tipler.
 *
 * Harita motoru platforma göre değişir (iOS: Apple Maps, Android: Mapbox) fakat
 * uygulama katmanı yalnızca bu tiplerle konuşur. Böylece tek bir harita
 * altyapısı bütün modüller tarafından yeniden kullanılabilir.
 */

export type LatLng = { lat: number; lng: number };

export type MapCamera = { lat: number; lng: number; zoom: number };

export type MapMode = 'social' | 'ride' | 'explore' | 'support';

export type MapLayerKey =
  | 'friends'
  | 'rides'
  | 'events'
  | 'places'
  | 'live'
  | 'reels'
  | 'help'
  | 'traffic'
  | 'weather';

export type MapDensity = 'simple' | 'balanced' | 'rich';

export type MapVisibility = 'ghost' | 'friends' | 'selected';

export type MapPrecision = 'approximate' | 'exact';

export type MapPointKind =
  | 'friend'
  | 'ride_offer'
  | 'ride_request'
  | 'event'
  | 'place'
  | 'real_estate'
  | 'live'
  | 'reel'
  | 'story'
  | 'help'
  | 'cluster';

export type MapPoint = {
  id: string;
  kind: MapPointKind;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string | null;
  username?: string | null;
  avatarPath?: string | null;
  avatarUrl?: string | null;
  precise?: boolean;
  updatedAt?: string | null;
  expiresAt?: string | null;
  /** Küme işaretlerinde içerilen nokta sayısı. */
  count?: number;
  /** Keşif işaretlerinde kısa rozet (fiyat vb.). */
  label?: string | null;
  /** Kategoriye özel işaret tonu; verilmezse tür tonu kullanılır. */
  tone?: 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  /** Kategoriye özel Ionicons adı. */
  icon?: string | null;
  /** Etiketli işaretlerde dolgu rengi (ör. deprem büyüklük ölçeği); tondan önceliklidir. */
  color?: string | null;
  /** `color` verildiğinde etiket yazı rengi. */
  textColor?: string | null;
  /**
   * Premium işaret (otel, tesis vb.): koyu zemin, altın çerçeve ve ikon +
   * etiket birlikte çizilir. `color` verilirse çerçeve rengini geçersiz kılar.
   */
  premium?: boolean;
  meta?: Record<string, unknown>;
};

export type MapShare = {
  id: string;
  audience: Exclude<MapVisibility, 'ghost'>;
  precise: boolean;
  started_at: string;
  expires_at: string;
  lat?: number;
  lng?: number;
  viewers?: string[];
};

export type MapPreferences = {
  userId: string;
  ghostMode: boolean;
  visibility: MapVisibility;
  precision: MapPrecision;
  defaultShareMinutes: number;
  activeMode: MapMode;
  layers: Record<MapLayerKey, boolean>;
  density: MapDensity;
  lastView: Partial<MapCamera> & { city?: string | null };
  onboardingDone: boolean;
  activeShare: MapShare | null;
};

export type MapExploreCounts = { friends: number; rides: number };

export type MapExploreResult = {
  center: LatLng;
  radiusKm: number;
  points: MapPoint[];
  counts: MapExploreCounts;
  generatedAt: string;
};

export type MapFriend = {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  isVerified: boolean;
  sharing: boolean;
};

export type MapSavedPlace = {
  id: string;
  title: string;
  address: string | null;
  lat: number;
  lng: number;
  category: string;
  note: string | null;
  collection: 'favorites' | 'wishlist' | 'trips' | 'custom';
  visibility: 'private' | 'link' | 'public';
  created_at: string;
};

export type MapRegion = {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
  radius_km: number;
  notify_mode: 'instant' | 'daily' | 'important' | 'off';
  created_at: string;
};

export type MapSearchResult = {
  id: string;
  label: string;
  shortLabel: string;
  lat: number;
  lng: number;
  kind: 'city' | 'district' | 'neighborhood' | 'place' | 'address';
};

export type MapAdminModuleState = 'ready' | 'partial' | 'not_configured';

export type MapAdminModule = {
  key: string;
  label: string;
  state: MapAdminModuleState;
};

export type MapAdminOverview = {
  preferences: {
    total: number;
    ghost: number;
    friends: number;
    selected: number;
    exact_precision: number;
    onboarded: number;
  };
  sharing: {
    active: number;
    expired_24h: number;
    stopped_24h: number;
    selected_audience: number;
    precise_active: number;
    viewer_grants: number;
    owners_24h: number;
  };
  library: {
    saved_places: number;
    public_places: number;
    link_places: number;
    collections: number;
    regions: number;
    instant_regions: number;
  };
  rides: {
    active_offers: number;
    with_coordinates: number;
    open_requests: number;
  };
  privacy: {
    ghost_default: boolean;
    exact_requires_explicit_consent: boolean;
    approximate_fuzz_meters: number;
    admin_coordinate_access: boolean;
    admin_identity_access: boolean;
    raw_gps_in_public_results: boolean;
    retention_note: string;
  };
  modules: MapAdminModule[];
};

export type MapAdminShare = {
  session_id: string;
  audience: 'friends' | 'selected';
  precise: boolean;
  started_at: string;
  expires_at: string;
  expires_in_minutes: number;
  viewer_count: number;
};

export type MapRoute = {
  distanceMeters: number;
  durationMinutes: number;
  geometry: LatLng[];
  alternatives: LatLng[][];
};

export type MapProviderId = 'apple-maps' | 'mapbox' | 'static';

export type MapCanvasMarker = MapPoint;
