/**
 * Eczane Rehberi — alan tipleri.
 *
 * Bütün veriler Supabase RPC'lerinden gelir (public.pharmacies_* /
 * public.admin_pharmacy_*). İstemcide eczane adı, nöbet saati, mahalle veya
 * puan UYDURULMAZ; eksik bilgi `null` taşınır ve arayüzde açıkça "bilinmiyor"
 * olarak gösterilir.
 */

// ---------------------------------------------------------------------------
// Durum (sunucuda Europe/Istanbul saatine göre hesaplanır)
// ---------------------------------------------------------------------------

export type PharmacyDutyState =
  | 'on_duty'
  | 'duty_today_later'
  | 'duty_today_ended'
  | 'none'
  | 'unknown';

export type PharmacyWorkState = 'open' | 'closed' | 'unknown';

export type PharmacyShiftStatus = 'confirmed' | 'unverified' | 'conflict' | 'cancelled';

/** `pharmacy_state()` içindeki `shift` nesnesi. */
export type PharmacyShift = {
  duty_date: string;
  starts_at: string;
  ends_at: string;
  status: PharmacyShiftStatus;
  /** Yalnızca `status = confirmed` ve `verified_at` doluysa true. */
  verified: boolean;
  fetched_at: string;
  source_name: string | null;
};

export type PharmacyState = {
  state: PharmacyDutyState;
  on_duty_now: boolean;
  duty_today: boolean;
  work_state: PharmacyWorkState;
  /** Doğrulanmış çalışma saati kaydı var mı? Yoksa saat tahmin edilmez. */
  hours_known: boolean;
  /** Nöbet kaydı tazelik eşiğini aştıysa true. */
  stale: boolean;
  duty_tracking: boolean;
  shift: PharmacyShift | null;
  checked_at: string;
};

// ---------------------------------------------------------------------------
// Liste / arama
// ---------------------------------------------------------------------------

export type PharmacyListMode = 'all' | 'duty_today' | 'on_duty_now' | 'nearby';

export type PharmacySummary = {
  id: string;
  slug: string;
  name: string;
  district: string | null;
  district_slug: string | null;
  neighborhood: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  review_count: number;
  cover_path: string | null;
  /** Kayıt doğrulanmış bir kaynaktan mı geldi? */
  data_verified: boolean;
  /** Yalnızca konum verildiğinde döner (kuş uçuşu, km). */
  distance_km: number | null;
  state: PharmacyState;
};

export type PharmacyListResponse = {
  items: PharmacySummary[];
  total: number;
  limit: number;
  offset: number;
  mode: string;
  today: string;
  generated_at: string;
};

export type PharmacyDistrictStat = {
  name: string;
  slug: string;
  pharmacy_count: number;
  duty_today: number;
};

export type PharmacySettings = {
  stale_after_hours: number;
  default_notify_hour: number;
  notifications_enabled: boolean;
  require_verified_duty: boolean;
  guide_intro: string | null;
};

export type PharmacyBootstrap = {
  districts: PharmacyDistrictStat[];
  total_pharmacies: number;
  duty_today_total: number;
  today: string;
  timezone: string;
  settings: PharmacySettings | null;
  data_sources: {
    enabled: number;
    live_feeds: number;
    manual_import: number;
    last_success_at: string | null;
  };
  generated_at: string;
};

// ---------------------------------------------------------------------------
// Günlük nöbet duyurusu
// ---------------------------------------------------------------------------

export type PharmacyDutyNoticeItem = {
  id: string;
  name: string;
  slug: string;
  district: string | null;
  neighborhood: string | null;
  starts_at: string;
  ends_at: string;
  status: PharmacyShiftStatus;
  duty_date: string;
  on_duty_now: boolean;
};

export type PharmacyDutyNotice = {
  date: string;
  district: string | null;
  neighborhood: string | null;
  count: number;
  on_duty_now: number;
  items: PharmacyDutyNoticeItem[];
  /** Kaynak tazelik eşiğini aştıysa true — "kesin güncel" iddiası kurulmaz. */
  stale: boolean;
  last_fetched_at: string | null;
  stale_after_hours: number;
  verified_sources_only: boolean;
  generated_at: string;
};

// ---------------------------------------------------------------------------
// Detay
// ---------------------------------------------------------------------------

/**
 * `working_hours` biçimi: `{ "1": [["09:00","19:00"]], … "7": [] }`
 * (1 = Pazartesi). Boş nesne "çalışma saati bilinmiyor" demektir.
 */
export type PharmacyWorkingHours = Record<string, [string, string][] | string[][]>;

export type PharmacyDutyRow = {
  id: string;
  duty_date: string;
  starts_at: string;
  ends_at: string;
  status: PharmacyShiftStatus;
  verified_at: string | null;
  fetched_at: string;
  source_name: string | null;
  source_attribution: string | null;
};

export type PharmacySourceRef = {
  id: string;
  name: string;
  kind: string;
  attribution_text: string | null;
  license_note: string | null;
};

/** Eczane galerisindeki onaylı fotoğraf (place_media). */
export type PharmacyPhoto = {
  id: string;
  kind: 'image' | 'video';
  storage_path: string | null;
  thumb_path: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
};

/** `pharmacy_duty_status()` — "bugün nöbetçi var mı, kayıt ne kadar taze". */
export type PharmacyDutyStatus = {
  date: string;
  timezone: string;
  count: number;
  on_duty_now: number;
  districts: number;
  stale: boolean;
  last_fetched_at: string | null;
  next_window_starts_at: string | null;
  stale_after_hours: number;
  source: {
    key: string;
    name: string;
    attribution: string | null;
    enabled: boolean;
    last_success_at: string | null;
    last_error: string | null;
  };
  generated_at: string;
};

export type PharmacyDetail = {
  id: string;
  slug: string;
  name: string;
  district: string | null;
  district_slug: string | null;
  neighborhood: string | null;
  neighborhood_verified: boolean;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  working_hours: PharmacyWorkingHours | null;
  working_hours_verified: boolean;
  data_verified: boolean;
  data_verified_at: string | null;
  duty_verified_at: string | null;
  inventory_source: string;
  rating: number | null;
  review_count: number;
  /** `{ "5": 12, "4": 3 … }` */
  rating_breakdown: Record<string, number>;
  cover_path: string | null;
  /** Onaylı galeri fotoğrafları (moderasyondan geçmiş). */
  photos: PharmacyPhoto[];
  photo_count: number;
  attribution_text: string | null;
  license_note: string | null;
  state: PharmacyState;
  duty: PharmacyDutyRow[];
  sources: PharmacySourceRef[];
  generated_at: string;
};

// ---------------------------------------------------------------------------
// Harita
// ---------------------------------------------------------------------------

export type PharmacyMapItem = {
  id: string;
  slug: string;
  name: string;
  district: string | null;
  neighborhood: string | null;
  address: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  state: PharmacyState;
};

export type PharmacyMapResponse = {
  items: PharmacyMapItem[];
  generated_at: string;
};

// ---------------------------------------------------------------------------
// Bildirim tercihleri
// ---------------------------------------------------------------------------

export type PharmacyNotificationPrefs = {
  enabled: boolean;
  /** Tek ilçe seçiliyken o ilçe; mahalle eşleşmesi için kullanılır. */
  district: string | null;
  districts: string[];
  neighborhood: string | null;
  /** 0–23 (Europe/Istanbul) */
  notify_hour: number;
  updated_at: string | null;
  global_enabled: boolean;
  allowed_channels: string[];
};

// ---------------------------------------------------------------------------
// Yönetim
// ---------------------------------------------------------------------------

export type PharmacyAdminPermissions = {
  view: boolean;
  manage: boolean;
  moderate: boolean;
  notify: boolean;
};

export type PharmacyAdminOverview = {
  permissions: PharmacyAdminPermissions;
  inventory: {
    total: number;
    with_coordinates: number;
    missing_address: number;
    missing_phone: number;
    missing_neighborhood: number;
    missing_hours: number;
    verified: number;
    tracked: number;
  };
  duty: {
    today: string;
    today_pharmacies: number;
    confirmed_today: number;
    unverified_today: number;
    conflicts: number;
    no_data: boolean;
    last_fetch: string | null;
  };
  queue: {
    unmatched: number;
    reviews_flagged: number;
    claims: number;
  };
  sources: {
    total: number;
    enabled: number;
    verified: number;
    last_run: string | null;
    last_failed: number;
  };
  notifications: {
    global_enabled: boolean;
    subscribers: number;
    sent_today: number;
  };
  settings: {
    stale_after_hours: number;
    default_notify_hour: number;
    require_verified_duty: boolean;
    timezone: string;
  };
};

export type PharmacyAdminListItem = {
  id: string;
  slug: string;
  name: string;
  district: string | null;
  neighborhood: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  duty_tracking: boolean;
  data_verified_at: string | null;
  duty_rows: number;
};

export type PharmacyAdminListItemResponse = {
  items: PharmacyAdminListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type PharmacyAdminDetail = {
  id: string;
  name: string;
  slug: string;
  district: string | null;
  neighborhood: string | null;
  neighborhood_source: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  working_hours: PharmacyWorkingHours | null;
  working_hours_source: string | null;
  inventory_source: string;
  duty_tracking: boolean;
  data_verified_at: string | null;
  duty_verified_at: string | null;
  notes: string | null;
  rating: number | null;
  review_count: number;
  updated_at: string;
  duty: {
    id: string;
    duty_date: string;
    starts_at: string;
    ends_at: string;
    status: PharmacyShiftStatus;
    verified_at: string | null;
    fetched_at: string;
    source_id: string | null;
    source_name: string | null;
    note: string | null;
  }[];
};

export type PharmacyAdminDutyRow = {
  id: string;
  place_id: string;
  name: string;
  slug: string;
  district: string | null;
  neighborhood: string | null;
  duty_date: string;
  starts_at: string;
  ends_at: string;
  status: PharmacyShiftStatus;
  source_name: string | null;
  source_id: string | null;
  verified_at: string | null;
  fetched_at: string;
  note: string | null;
};

export type PharmacyUnmatchedRow = {
  id: string;
  raw_name: string;
  raw_district: string | null;
  raw_neighborhood: string | null;
  duty_date: string;
  status: string;
};

export type PharmacyAdminSourceRef = {
  id: string;
  key: string;
  name: string;
  is_enabled: boolean;
  verified_license: boolean;
  last_success_at: string | null;
  last_error: string | null;
};

export type PharmacyAdminDutyResponse = {
  date: string;
  today: string;
  items: PharmacyAdminDutyRow[];
  unmatched: PharmacyUnmatchedRow[];
  sources: PharmacyAdminSourceRef[];
};

export type PharmacySource = {
  id: string;
  key: string;
  name: string;
  kind: string;
  homepage_url: string | null;
  terms_url: string | null;
  license_note: string | null;
  attribution_text: string | null;
  /** Yalnızca ortam değişkeni ADI. Ham anahtar hiçbir zaman dönmez. */
  api_secret_ref: string | null;
  has_field_map: boolean;
  is_primary: boolean;
  is_enabled: boolean;
  priority: number;
  sync_interval_minutes: number;
  verified_license: boolean;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

export type PharmacySyncLog = {
  id: string;
  source_key: string | null;
  run_kind: string;
  status: string;
  records_received: number;
  records_matched: number;
  records_unmatched: number;
  records_rejected: number;
  duty_written: number;
  conflicts: number;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  started_at: string;
};

export type PharmacySourcesResponse = {
  items: PharmacySource[];
  logs: PharmacySyncLog[];
};

export type PharmacySourceTestResult = {
  id: string;
  key: string;
  ready: boolean;
  checks: { key: string; ok: boolean; label: string }[];
  last_success_at: string | null;
  last_error: string | null;
};

export type PharmacyAdminReview = {
  id: string;
  place_id: string;
  pharmacy_name: string;
  pharmacy_slug: string;
  district: string | null;
  rating: number;
  body: string | null;
  status: string;
  helpful_count: number;
  created_at: string;
  author_username: string | null;
  author_display_name: string | null;
  report_count: number;
};

export type PharmacyAdminReviewResponse = {
  items: PharmacyAdminReview[];
  total: number;
};

export type PharmacyAdminReport = {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  review_id: string;
  review_body: string | null;
  review_rating: number;
  pharmacy_name: string;
  pharmacy_slug: string;
};

export type PharmacyNotificationPreview = {
  date: string;
  district: string | null;
  neighborhood: string | null;
  eligible_subscribers: number;
  notice_count: number;
  stale: boolean;
  sendable: boolean;
  title: string;
  body: string;
  already_sent: number;
};

export type PharmacyNotificationDispatchResult = {
  date: string;
  dry_run: boolean;
  eligible: number;
  sent: number;
  skipped: number;
  samples: {
    user_id: string;
    district: string | null;
    neighborhood: string | null;
    title: string;
    body: string;
    route: string;
  }[];
  generated_at: string;
};

export type PharmacyQuality = {
  missing: { address: number; phone: number; neighborhood: number; hours: number };
  duplicates: {
    district: string | null;
    core_name: string;
    count: number;
    items: { id: string; name: string; slug: string; phone: string | null }[];
  }[];
  unmatched_pending: number;
  stale_duty_days: { duty_date: string; records: number }[];
};

export type PharmacySettingsResponse = {
  id: number;
  stale_after_hours: number;
  default_notify_hour: number;
  notifications_enabled: boolean;
  require_verified_duty: boolean;
  default_duty_start: string;
  default_duty_end: string;
  guide_intro: string | null;
  timezone: string;
  updated_at: string;
};
