/**
 * Trabzone Keşfet — işletme, emlak ve alan araması tipleri.
 *
 * Bu tipler `explore_*`, `place_*`, `re_*` ve `map_area_search` RPC'lerinin
 * döndürdüğü JSON sözleşmesini birebir yansıtır. Arayüzde varsayılan/örnek
 * veri yoktur; her alan gerçek veritabanı yanıtından gelir.
 */

export type LatLng = { lat: number; lng: number };

export type ExploreCity = {
  id: number;
  plate_code: number;
  name: string;
  slug: string;
  center_lat: number;
  center_lng: number;
};

export type ExploreServiceRegion = {
  name: string;
  is_active: boolean;
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  boundary_available: boolean;
};

export type Neighborhood = {
  id: number;
  name: string;
  slug: string;
};

export type District = {
  id: number;
  name: string;
  slug: string;
  lat: number | null;
  lng: number | null;
  neighborhoods: Neighborhood[];
};

export type PlaceCategory = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  tone: string | null;
  sort_order: number;
  children: PlaceCategory[];
};

export type RealEstateCategory = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  listing_kind: 'rent' | 'sale' | 'transfer';
  sort_order: number;
  children: RealEstateCategory[];
};

export type ExploreBootstrap = {
  city: ExploreCity;
  service_region: ExploreServiceRegion | null;
  districts: District[];
  place_categories: PlaceCategory[];
  real_estate_categories: RealEstateCategory[];
  eids_enabled: boolean;
};

export type PlaceMarker = {
  kind: 'place';
  id: string;
  name: string;
  category_slug: string | null;
  category_name: string | null;
  icon: string | null;
  tone: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  review_count: number;
  photo_count: number;
  video_count: number;
  cover_path: string | null;
  is_verified: boolean;
  price_level: number | null;
  district: string | null;
  neighborhood: string | null;
  district_id: number | null;
  neighborhood_id: number | null;
};

export type RealEstateMarker = {
  kind: 'real_estate';
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  price_period: 'month' | 'total' | string | null;
  listing_kind: 'rent' | 'sale' | 'transfer';
  category_slug: string;
  category_name: string;
  lat: number;
  lng: number;
  gross_m2: number | null;
  net_m2: number | null;
  room_count: number | null;
  district: string | null;
  neighborhood: string | null;
  cover_path: string | null;
  is_favorite: boolean;
  published_at: string | null;
};

export type ExploreMarker = PlaceMarker | RealEstateMarker;

export type Bbox = { west: number; east: number; south: number; north: number };

export type MarkerResponse<T> = {
  items: T[];
  total: number;
  truncated: boolean;
  bbox?: Bbox;
};

export type PlaceMedia = {
  id: string;
  kind: 'image' | 'video';
  storage_path: string;
  thumb_path: string | null;
  reel_id: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  uploader: { id: string; username: string; display_name: string | null };
};

export type LinkedReel = {
  id: string;
  video_path: string;
  cover_path: string | null;
  caption: string | null;
  duration_ms: number | null;
  like_count: number;
  comment_count: number;
  view_count: number;
  created_at: string;
  author: { username: string; display_name: string | null; avatar_path: string | null };
};

export type LinkedPost = {
  id: string;
  body: string | null;
  created_at: string;
  author: { username: string; display_name: string | null; avatar_path: string | null };
};

export type PlaceOwner = {
  username: string;
  display_name: string | null;
  avatar_path: string | null;
};

export type PlaceDetail = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: { id: string; slug: string; name: string; icon: string | null; tone: string | null } | null;
  categories: string[];
  city_id: number;
  district_id: number | null;
  neighborhood_id: number | null;
  district: string | null;
  neighborhood: string | null;
  address: string | null;
  lat: number;
  lng: number;
  phone: string | null;
  website: string | null;
  cover_path: string | null;
  opening_hours: Record<string, unknown> | null;
  price_level: number | null;
  status: string;
  verification_status: string;
  is_verified: boolean;
  data_source: string;
  external_provider: string | null;
  external_id: string | null;
  attribution_text: string | null;
  license_note: string | null;
  rating_avg: number | null;
  rating_count: number;
  review_count: number;
  photo_count: number;
  video_count: number;
  favorite_count: number;
  view_count: number;
  rating_breakdown: Record<string, number>;
  is_favorite: boolean;
  is_manager: boolean;
  can_claim: boolean;
  owner: PlaceOwner | null;
  media: PlaceMedia[];
  reels: LinkedReel[];
  posts: LinkedPost[];
  created_at: string;
  updated_at: string;
};

export type PlaceReviewMedia = {
  id: string;
  kind: 'image' | 'video';
  storage_path: string;
  status: string;
};

export type PlaceReviewReply = {
  review_id: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type PlaceReview = {
  id: string;
  rating: number;
  body: string | null;
  status: string;
  helpful_count: number;
  helpful_by_me: boolean;
  is_mine: boolean;
  created_at: string;
  updated_at: string;
  /** İşletme sahibinin resmî yanıtı (varsa). */
  reply?: PlaceReviewReply | null;
  author: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_path: string | null;
    is_verified: boolean;
  };
  media: PlaceReviewMedia[];
};

export type ReviewPage = {
  items: PlaceReview[];
  total: number;
  limit: number;
  offset: number;
};

export type ExploreSearchItem = {
  kind: 'place' | 'real_estate' | 'district' | 'neighborhood';
  id: string | number;
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  image_path: string | null;
  rating: number | null;
  category: string | null;
  verified: boolean;
  /** İşletme kaydında varsa açık adres (arama sonucu kartında gösterilir). */
  address?: string | null;
  /** İşletme kaydında varsa telefon. */
  phone?: string | null;
};

/** Harici harita sağlayıcıları ("Haritaya yer ekle" araması). */
export type ExternalPlaceSource = 'google' | 'apple' | 'osm';

/**
 * Google / Apple haritalarından gelen işletme önerisi. Trabzone'da henüz
 * kaydı olmayan işletmeleri forma tek dokunuşla doldurmak için kullanılır.
 */
export type ExternalPlaceSuggestion = {
  id: string;
  source: ExternalPlaceSource;
  /** Aynı işletme iki sağlayıcıda da bulunduysa ikisi birden listelenir. */
  sources: ExternalPlaceSource[];
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** Sağlayıcının kendi kategori etiketi (örn. "Kahvaltı salonu"). */
  category: string | null;
  /** Sağlayıcı tip kodları; Trabzone kategorisine eşlemek için kullanılır. */
  types: string[];
  phone: string | null;
  website: string | null;
  rating: number | null;
  ratingCount: number | null;
  /** Sağlayıcı işletmeyi geçici olarak kapalı işaretlediyse true. */
  closed: boolean;
  /** Sağlayıcıdaki kalıcı kimlik (örn. OSM `node/123`). Kayıt tekilleştirmede kullanılır. */
  externalId?: string | null;
};

/**
 * Trabzone'da fotoğrafı olmayan işletme için Google Haritalar'dan gelen kapak.
 * `url` kısa ömürlüdür ve saklanmaz; gösterirken atıf zorunludur.
 */
export type ExternalPlacePhoto = {
  url: string;
  width: number | null;
  height: number | null;
  source: 'google';
  attributions: { name: string; uri: string | null }[];
};

export type AreaSearchResult = {
  places: PlaceMarker[];
  listings: RealEstateMarker[];
  counts: { places: number; listings: number };
  area_m2: number;
};

export type SavedArea = {
  id: string;
  label: string;
  area_kind: 'map' | 'real_estate';
  filters: Record<string, unknown>;
  notify_enabled: boolean;
  created_at: string;
  geometry: { type: 'Polygon'; coordinates: number[][][] } | null;
};

export type ExploreLibrary = {
  places: PlaceMarker[];
  listings: RealEstateMarker[];
};

export type RealEstateListing = {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  price_period: string | null;
  listing_kind: 'rent' | 'sale' | 'transfer';
  owner_type: 'owner' | 'agent' | 'business';
  status: string;
  verification_status: string;
  category_slug: string;
  category_name: string;
  lat: number;
  lng: number;
  gross_m2: number | null;
  net_m2: number | null;
  room_count: number | null;
  building_age: number | null;
  floor_no: number | null;
  district: string | null;
  neighborhood: string | null;
  district_id: number | null;
  neighborhood_id: number | null;
  cover_path: string | null;
  /**
   * Kart üzerindeki fotoğraf şeridi için onaylı görsellerin ilk birkaçı.
   * Eski liste yanıtlarında bulunmayabilir.
   */
  photos?: string[];
  photo_count?: number;
  /** İlanı paylaşan kişi; listede kart üzerinde gösterilir. */
  owner?: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_path: string | null;
    is_verified: boolean;
  } | null;
  is_favorite: boolean;
  is_mine: boolean;
  published_at: string | null;
  created_at: string;
};

export type RealEstateMedia = {
  id: string;
  kind: 'image' | 'video';
  storage_path: string;
  cover: boolean;
  caption: string | null;
  sort_order: number;
  status: string;
};

export type RealEstateVerification = {
  id: string;
  kind: string;
  status: string;
  reference_no: string | null;
  expires_at: string | null;
  created_at: string;
};

export type RealEstateDetail = {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  price_period: string | null;
  listing_kind: 'rent' | 'sale' | 'transfer';
  owner_type: 'owner' | 'agent' | 'business';
  status: string;
  verification_status: string;
  eids_status: string;
  eids_verified_at: string | null;
  category: { id: string; slug: string; name: string; icon: string | null; listing_kind: string } | null;
  city_id: number;
  district_id: number | null;
  neighborhood_id: number | null;
  district: string | null;
  neighborhood: string | null;
  address_text: string | null;
  address_private: string | null;
  hide_exact_location: boolean;
  lat: number;
  lng: number;
  public_lat: number;
  public_lng: number;
  gross_m2: number | null;
  net_m2: number | null;
  room_count: number | null;
  living_room_count: number | null;
  building_age: number | null;
  floor_no: number | null;
  total_floors: number | null;
  heating: string | null;
  furnished: boolean | null;
  balcony: boolean | null;
  parking: boolean | null;
  elevator: boolean | null;
  deposit_cents: number | null;
  dues_cents: number | null;
  attributes: Record<string, unknown>;
  published_at: string | null;
  expires_at: string | null;
  view_count: number;
  favorite_count: number;
  rejection_reason: string | null;
  is_favorite: boolean;
  is_mine: boolean;
  media: RealEstateMedia[];
  verifications: RealEstateVerification[];
  eids_enabled: boolean;
  owner: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_path: string | null;
    is_verified: boolean;
  };
  created_at: string;
  updated_at: string;
};

export type MyListing = {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  price_period: string | null;
  listing_kind: string;
  status: string;
  verification_status: string;
  eids_status: string;
  rejection_reason: string | null;
  category_slug: string;
  category_name: string;
  district: string | null;
  neighborhood: string | null;
  cover_path: string | null;
  view_count: number;
  favorite_count: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type RealEstateSavedSearch = {
  id: string;
  label: string;
  filters: Record<string, unknown>;
  notify_enabled: boolean;
  created_at: string;
  geometry: { type: 'Polygon'; coordinates: number[][][] } | null;
  last_notified_at: string | null;
};

export type ReListFilters = {
  listing_kind?: 'rent' | 'sale' | 'transfer' | null;
  category?: string | null;
  district_id?: number | null;
  neighborhood_id?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  min_m2?: number | null;
  max_m2?: number | null;
  rooms?: number | null;
  max_building_age?: number | null;
  owner_type?: 'owner' | 'agent' | 'business' | null;
  sort?: 'new' | 'price_asc' | 'price_desc' | 'popular';
  query?: string | null;
  favorites?: boolean;
  mine?: boolean;
  limit?: number;
  offset?: number;
};

export type RealEstateDraftInput = {
  category_slug: string;
  title: string;
  description?: string | null;
  price_cents: number;
  currency?: string;
  price_period?: string | null;
  owner_type: 'owner' | 'agent' | 'business';
  district_id: number;
  neighborhood_id?: number | null;
  address_text?: string | null;
  address_private?: string | null;
  hide_exact_location?: boolean;
  lat: number;
  lng: number;
  gross_m2?: number | null;
  net_m2?: number | null;
  room_count?: number | null;
  living_room_count?: number | null;
  building_age?: number | null;
  floor_no?: number | null;
  total_floors?: number | null;
  heating?: string | null;
  furnished?: boolean | null;
  balcony?: boolean | null;
  parking?: boolean | null;
  elevator?: boolean | null;
  deposit_cents?: number | null;
  dues_cents?: number | null;
  attributes?: Record<string, unknown>;
};

export type PlaceSuggestionInput = {
  name: string;
  category_slug: string;
  district_id: number;
  neighborhood_id?: number | null;
  address?: string | null;
  description?: string | null;
  phone?: string | null;
  lat: number;
  lng: number;
  media?: { kind: 'image' | 'video'; storage_path: string }[];
};

export type AdminExploreOverview = {
  permissions: Record<string, boolean>;
  eids_enabled: boolean;
  places: {
    total: number;
    published: number;
    pending: number;
    verified: number;
    without_photo: number;
    missing_address: number;
  };
  queue: Record<string, number>;
  real_estate: {
    total: number;
    published: number;
    pending: number;
    draft: number;
    rejected: number;
    expired: number;
  };
  categories: { place: number; real_estate: number };
  districts: number;
};

export type AdminPlaceRow = {
  id: string;
  name: string;
  status: string;
  verification_status: string;
  category_slug: string | null;
  category_name: string | null;
  district: string | null;
  neighborhood: string | null;
  district_id: number | null;
  address: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  rating_avg: number | null;
  review_count: number;
  photo_count: number;
  video_count: number;
  pending_media: number;
  pending_claims: number;
  owner_id: string | null;
  is_verified: boolean;
  cover_path: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminPlaceCategory = {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  icon: string;
  tone: string;
  sort_order: number;
  is_active: boolean;
  place_count: number;
  children_count: number;
};

export type AdminPlaceMediaRow = {
  id: string;
  kind: 'image' | 'video' | string;
  storage_path: string;
  thumb_path: string | null;
  caption: string | null;
  status: string;
  sort_order: number;
  reel_id: string | null;
  uploader_id: string | null;
  created_at: string;
};

export type AdminPlaceDetail = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: { id: string; slug: string; name: string; icon: string; tone: string } | null;
  category_slugs: string[];
  address: string | null;
  address_public: boolean;
  lat: number;
  lng: number;
  phone: string | null;
  website: string | null;
  cover_path: string | null;
  status: string;
  verification_status: string;
  is_verified: boolean;
  data_source: string | null;
  external_provider: string | null;
  external_id: string | null;
  rating_avg: number | null;
  rating_count: number;
  review_count: number;
  photo_count: number;
  video_count: number;
  favorite_count: number;
  view_count: number;
  district_id: number | null;
  neighborhood_id: number | null;
  district: string | null;
  neighborhood: string | null;
  owner_id: string | null;
  owner: {
    id: string;
    username: string;
    first_name: string | null;
    last_name: string | null;
    is_verified: boolean;
    account_status: string;
  } | null;
  media: AdminPlaceMediaRow[];
  claims: {
    id: string;
    status: string;
    applicant_id: string | null;
    applicant: string | null;
    evidence_type: string;
    evidence_text: string;
    document_path: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    review_note: string | null;
    created_at: string;
  }[];
  reviews: {
    id: string;
    rating: number;
    body: string | null;
    status: string;
    helpful_count: number;
    author: string | null;
    author_id: string | null;
    created_at: string;
  }[];
  reports: {
    id: string;
    target_type: string;
    reason: string;
    status: string;
    details: string | null;
    created_at: string;
  }[];
  created_at: string;
  updated_at: string;
};

export type AdminPlaceList = {
  items: AdminPlaceRow[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminReRow = {
  id: string;
  title: string;
  status: string;
  verification_status: string;
  eids_status: string;
  listing_kind: string;
  owner_type: string;
  price_cents: number;
  currency: string;
  price_period: string | null;
  category_slug: string;
  category_name: string;
  district: string | null;
  neighborhood: string | null;
  lat: number;
  lng: number;
  cover_path: string | null;
  media_count: number;
  pending_media: number;
  owner: string | null;
  rejection_reason: string | null;
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export type AdminReList = {
  items: AdminReRow[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminVerificationRow = {
  id: string;
  listing_id: string;
  listing_title: string;
  kind: string;
  status: string;
  reference_no: string | null;
  document_path: string | null;
  note: string | null;
  owner: string | null;
  created_at: string;
  expires_at: string | null;
};

export type AdminRealEstateDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  verification_status: string;
  eids_status: string;
  eids_reference: string | null;
  eids_verified_at: string | null;
  eids_expires_at: string | null;
  listing_kind: string;
  owner_type: string;
  price_cents: number;
  currency: string;
  price_period: string | null;
  category: { id: string; slug: string; name: string; listing_kind: string } | null;
  district: string | null;
  neighborhood: string | null;
  address_text: string | null;
  address_private: string | null;
  hide_exact_location: boolean;
  lat: number;
  lng: number;
  public_lat: number | null;
  public_lng: number | null;
  gross_m2: number | null;
  net_m2: number | null;
  room_count: number | null;
  building_age: number | null;
  rejection_reason: string | null;
  published_at: string | null;
  expires_at: string | null;
  view_count: number;
  favorite_count: number;
  owner: {
    id: string;
    username: string;
    first_name: string | null;
    last_name: string | null;
    is_verified: boolean;
    account_status: string;
  } | null;
  media: {
    id: string;
    kind: 'image' | 'video' | string;
    storage_path: string;
    cover: boolean;
    caption: string | null;
    sort_order: number;
    status: string;
    uploader_id: string | null;
    created_at: string;
  }[];
  verifications: {
    id: string;
    kind: string;
    status: string;
    reference_no: string | null;
    document_path: string | null;
    note: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    expires_at: string | null;
    created_at: string;
  }[];
  moderation: {
    id: string;
    action: string;
    reason: string | null;
    admin_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }[];
  reports: {
    id: string;
    reason: string;
    status: string;
    details: string | null;
    target_type: string;
    created_at: string;
  }[];
  eids_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminMediaRow = {
  id: string;
  place_id?: string;
  listing_id?: string;
  place_name?: string;
  listing_title?: string;
  kind: string;
  storage_path: string;
  status: string;
  caption: string | null;
  uploader: string | null;
  created_at: string;
};

export type AdminReviewRow = {
  id: string;
  place_id: string;
  place_name: string;
  author: string | null;
  rating: number;
  body: string | null;
  status: string;
  helpful_count: number;
  created_at: string;
};

export type AdminClaimRow = {
  id: string;
  status: string;
  place_id: string;
  place_name: string;
  place_district: string | null;
  applicant: string | null;
  evidence_type: string;
  evidence_text: string;
  document_path: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  review_note: string | null;
  created_at: string;
};

export type AdminSuggestionRow = {
  id: string;
  status: string;
  payload: PlaceSuggestionInput & {
    photo_paths?: string[];
    video_paths?: string[];
    submitted_by?: string;
  };
  review_note: string | null;
  created_place_id: string | null;
  submitter: string | null;
  created_at: string;
};

export type AdminReportRow = {
  id: string;
  target_type: string;
  target_id: string;
  target_label: string | null;
  reason: string;
  details: string | null;
  status: string;
  reporter: string | null;
  created_at: string;
};

export type ExploreHealth = {
  generated_at: string;
  places: {
    total: number;
    published: number;
    verified: number;
    missing_address: number;
    invalid_coordinates: number;
    without_photo: number;
    without_category: number;
    without_neighborhood: number;
    duplicates: number;
  };
  queue: Record<string, number>;
  real_estate: {
    total: number;
    published: number;
    pending: number;
    draft: number;
    rejected: number;
    expired: number;
    missing_public_location: number;
    without_approved_media: number;
  };
  duplicate_samples: {
    id_a: string;
    name_a: string;
    id_b: string;
    name_b: string;
    district: string | null;
    distance_m: number;
    name_score: number;
  }[];
  spatial_query: { sample: string; latency_ms: number; status: 'ok' | 'slow' | 'critical' };
  map_service: { status: string; reason: string };
  eids: { enabled: boolean; status: string; note: string };
};
