/**
 * Haber Ağı — API ve Kaynak Yönetimi tipleri.
 *
 * Bu tipler `admin_news_*` RPC'lerinin döndürdüğü JSON ile birebir eşleşir.
 * Kaynak sırları (API anahtarı) hiçbir zaman burada taşınmaz; yalnızca
 * `has_credentials` ve maskeli `secret_hint` alanları bulunur.
 */

export type NewsConnectorKind = 'rss' | 'atom' | 'xml' | 'json_feed' | 'rest_json' | 'custom_api';
export type NewsStatus = 'draft' | 'active' | 'paused' | 'disabled' | 'deleting';
export type NewsHealth = 'unknown' | 'ok' | 'warning' | 'error';
export type NewsPublishMode = 'discovery' | 'source_profile' | 'trabzone_digest' | 'editor_approval';
export type NewsLicenseStatus = 'unverified' | 'permitted' | 'restricted' | 'prohibited';
export type NewsItemStatus =
  | 'new'
  | 'pending_review'
  | 'drafted'
  | 'published'
  | 'duplicate'
  | 'blocked'
  | 'rejected'
  | 'removed';

export type NewsSourceProfile = {
  id: string;
  profile_id: string | null;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  description: string | null;
  website: string | null;
  verified: boolean;
  verification_note: string | null;
  status: 'active' | 'unpublished' | 'removed';
};

export type NewsConnectionStats = {
  items_total: number;
  items_published: number;
  items_pending: number;
  items_blocked: number;
  items_duplicate: number;
  items_removed: number;
  drafts_total: number;
  sitemap_urls: number;
  items_24h: number;
  published_24h: number;
  last_run: {
    id: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    http_status: number | null;
    response_ms: number | null;
    items_seen: number;
    items_new: number;
    items_published: number;
    error: string | null;
  } | null;
};

export type NewsConnection = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  homepage_url: string | null;
  feed_url: string;
  connector_kind: NewsConnectorKind;
  http_method: string;
  auth_kind: string;
  auth_header_name: string | null;
  auth_query_param: string | null;
  auth_username: string | null;
  has_credentials: boolean;
  secret_hint: string | null;
  default_params: Record<string, unknown>;
  items_path: string | null;
  pagination_kind: string;
  pagination_param: string | null;
  next_path: string | null;
  since_param: string | null;
  field_hints: Record<string, unknown>;
  timezone: string;
  poll_interval_minutes: number;
  status: NewsStatus;
  health_status: NewsHealth;
  auto_publish_enabled: boolean;
  publish_mode: NewsPublishMode;
  publisher_profile_id: string | null;
  license_status: NewsLicenseStatus;
  license_note: string | null;
  max_items_per_run: number;
  page_limit: number;
  request_timeout_ms: number;
  max_response_bytes: number;
  retry_count: number;
  backoff_seconds: number;
  daily_request_budget: number;
  requests_today: number;
  rate_limited_until: string | null;
  min_publish_interval_seconds: number;
  ai_classification: boolean;
  regions: string[];
  notes: string | null;
  archived_at: string | null;
  purge_profile: boolean;
  last_item_at: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  last_http_status: number | null;
  last_response_ms: number | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_detail: NewsTestResult | null;
  auto_disabled_reason: string | null;
  created_at: string;
  updated_at: string;
  profile: NewsSourceProfile | null;
  stats: NewsConnectionStats;
};

export type NewsOverview = {
  connections_total: number;
  connections_active: number;
  connections_paused: number;
  connections_disabled: number;
  connections_error: number;
  items_total: number;
  items_published: number;
  items_pending: number;
  items_blocked: number;
  items_duplicate: number;
  items_24h: number;
  published_24h: number;
  published_total: number;
  deletions_running: number;
  unlicensed_sources: number;
  last_success_at: string | null;
  avg_response_ms: number | null;
  requests_today: number;
};

export type NewsCategoryOption = {
  slug: string;
  name: string;
  trabzon_default: boolean;
};

export type NewsTemplate = {
  code: string;
  name: string;
  homepage_url: string | null;
  feed_url: string | null;
  connector_kind: NewsConnectorKind;
  license_note: string | null;
  rights_url: string | null;
  default_categories: string[];
  is_verified: boolean;
};

export type NewsCatalog = {
  categories: NewsCategoryOption[];
  districts: { name: string; slug: string }[];
  templates: NewsTemplate[];
  publish_modes: { value: NewsPublishMode; label: string; requires_text: boolean }[];
  connector_kinds: { value: NewsConnectorKind; label: string; group: string }[];
  license_statuses: { value: NewsLicenseStatus; label: string }[];
};

export type NewsFieldMapping = {
  field_key: string;
  source_path: string;
  transform: string;
  is_auto: boolean;
};

export type NewsCategoryMapping = {
  source_category: string;
  target_slug: string;
  is_auto: boolean;
};

export type NewsFilters = {
  connection_id: string;
  categories: string[];
  news_types: string[];
  location: { mode?: string; districts?: string[] };
  content: Record<string, unknown>;
  date_window_hours: number;
  max_age_days: number;
  updated_at: string;
};

export type NewsPermissions = {
  connection_id: string;
  can_republish_text: boolean;
  can_republish_summary: boolean;
  can_use_images: boolean;
  can_use_logo: boolean;
  can_use_video: boolean;
  attribution_required: boolean;
  attribution_text: string | null;
  terms_url: string | null;
  evidence_url: string | null;
  verified_by: string | null;
  verified_at: string | null;
};

export type NewsHealthLog = {
  id: string;
  checked_at: string;
  kind: string;
  ok: boolean;
  http_status: number | null;
  response_ms: number | null;
  payload_format: string | null;
  item_count: number | null;
  error: string | null;
};

export type NewsRun = {
  id: string;
  trigger_kind: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  http_status: number | null;
  response_ms: number | null;
  items_seen: number;
  items_new: number;
  items_duplicate: number;
  items_blocked: number;
  items_published: number;
  error: string | null;
};

export type NewsDeletionJobListItem = {
  id: string;
  scope: 'disable_only' | 'remove_content' | 'purge';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  requested_at: string;
  finished_at: string | null;
  counts: NewsDeletionCounts;
};

export type NewsConnectionDetail = {
  connection: NewsConnection;
  field_mappings: NewsFieldMapping[];
  category_mappings: NewsCategoryMapping[];
  filters: NewsFilters | null;
  permissions: NewsPermissions | null;
  health: NewsHealthLog[];
  runs: NewsRun[];
  deletion_jobs: NewsDeletionJobListItem[];
};

export type NewsTestSample = {
  title: string;
  summary: string | null;
  url: string | null;
  published_at: string | null;
  author: string | null;
  source_category: string | null;
  city: string | null;
  district: string | null;
  image_url: string | null;
  has_image: boolean;
  has_video: boolean;
  body_length: number;
};

export type NewsTestResult = {
  ok: boolean;
  http_status: number | null;
  response_ms: number | null;
  bytes?: number;
  content_type?: string | null;
  format: string | null;
  feed_title?: string | null;
  auth_ok: boolean | null;
  item_count: number;
  sample: NewsTestSample[];
  fields: string[];
  pagination: { kind: string; next?: string | null } | null;
  error: string | null;
};

export type NewsItem = {
  id: string;
  title: string;
  summary: string | null;
  canonical_url: string | null;
  image_url: string | null;
  image_storage_path: string | null;
  source_category: string | null;
  category_slug: string | null;
  district: string | null;
  published_at: string | null;
  first_seen_at: string;
  status: NewsItemStatus;
  block_reason: string | null;
  post_id: string | null;
  post_status: string | null;
  mode: string | null;
  license_snapshot: Record<string, unknown> | null;
};

export type NewsItemDetail = NewsItem & {
  connection_id: string;
  external_id: string | null;
  body: string | null;
  video_url: string | null;
  author: string | null;
  source_name: string | null;
  removed_at: string | null;
  removed_reason: string | null;
  post: {
    id: string;
    body: string;
    moderation_status: string;
    like_count: number;
    comment_count: number;
    created_at: string;
  } | null;
};

export type NewsDeletionCounts = {
  items_total: number;
  items_published: number;
  items_pending: number;
  items_blocked: number;
  posts_total: number;
  posts_exclusive: number;
  posts_shared: number;
  media_count: number;
  sitemap_urls: number;
  profile_bound: boolean;
  profile_shared: boolean;
  profile_verified: boolean;
  profile_display_name: string | null;
  profile_followers: number;
  connection_name: string;
};

export type NewsDeletionPreview = NewsDeletionCounts;

export type NewsDeletionJob = {
  id: string;
  connection_id: string;
  connection_name: string;
  scope: 'disable_only' | 'remove_content' | 'purge';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  reason: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  counts: NewsDeletionCounts;
  progress: { processed?: number; remaining?: number; finished?: boolean };
  error: string | null;
};

export type NewsDeletionMediaStatus = {
  pending: number;
  done: number;
  failed: number;
};

export type NewsDeletionResultRow = {
  id: number;
  item_id: string | null;
  post_id: string | null;
  outcome: string;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type NewsSettings = {
  id: boolean;
  enabled: boolean;
  ai_enabled: boolean;
  worker_url: string | null;
  dispatch_interval_minutes: number;
  ai_daily_budget: number;
  media_download_enabled: boolean;
  worker_secret: boolean;
  last_tick_at: string | null;
  next_run_at: string | null;
  queue_pending: number;
  queue_blocked: number;
  active_sources: number;
  updated_at: string;
};

export type NewsPublisherCandidate = {
  id: string;
  username: string | null;
  display_name: string | null;
  is_verified: boolean;
  avatar_path: string | null;
  followers_count: number;
  account_status: string;
};

export type NewsConnectionSaveInput = {
  id?: string | null;
  name: string;
  description?: string | null;
  homepage_url?: string | null;
  feed_url?: string | null;
  template_code?: string | null;
  connector_kind: NewsConnectorKind;
  http_method?: string;
  auth_kind?: string;
  auth_header_name?: string | null;
  auth_query_param?: string | null;
  auth_username?: string | null;
  default_params?: Record<string, unknown>;
  items_path?: string | null;
  pagination_kind?: string;
  pagination_param?: string | null;
  next_path?: string | null;
  since_param?: string | null;
  timezone?: string;
  poll_interval_minutes?: number;
  publish_mode?: NewsPublishMode;
  publisher_profile_id?: string | null;
  license_status?: NewsLicenseStatus;
  license_note?: string | null;
  max_items_per_run?: number;
  page_limit?: number;
  request_timeout_ms?: number;
  max_response_bytes?: number;
  retry_count?: number;
  backoff_seconds?: number;
  daily_request_budget?: number;
  min_publish_interval_seconds?: number;
  ai_classification?: boolean;
  regions?: string[];
  notes?: string | null;
};
