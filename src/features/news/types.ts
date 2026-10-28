/** Trabzone AI Haber Merkezi — paylaşılan istemci tipleri. */

export type NewsRiskLevel = 'A' | 'B' | 'C';

export type NewsQueueState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'archived'
  | 'all';

export type NewsRunStatus = 'running' | 'completed' | 'partial' | 'failed' | 'skipped';

export type NewsRunStats = {
  searches?: number;
  search_results?: number;
  new_results?: number;
  ignored_results?: number;
  events?: number;
  duplicates?: number;
  verified?: number;
  drafts?: number;
  published?: number;
  queued?: number;
  errors?: number;
  cost_usd?: number;
  duration_ms?: number;
  [key: string]: unknown;
};

export type NewsPublisher = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
  is_verified: boolean;
};

export type NewsQuota = {
  day: string;
  auto_limit: number;
  auto_published: number;
  manual_published: number;
  remaining: number;
};

export type NewsBudget = {
  daily_limit_usd: number;
  monthly_limit_usd: number;
  today_usd: number;
  month_usd: number;
  daily_exhausted: boolean;
  monthly_exhausted: boolean;
  exhausted: boolean;
};

export type NewsOverviewCounts = {
  found_today: number;
  events_today: number;
  verified_today: number;
  published_today: number;
  published_today_all: number;
  pending_review: number;
  rejected_today: number;
  duplicates_today: number;
  media_missing: number;
  errors_24h: number;
};

export type NewsCostSummaryBlock = {
  cost_usd: number;
  search_calls: number;
  fetch_calls: number;
  model_calls: number;
  tokens_in: number;
  tokens_out: number;
};

export type NewsDiagnostics = {
  checked_at?: string;
  models?: string[];
  chat_ok?: boolean;
  search_ok?: boolean;
  fetch_ok?: boolean;
  balance?: { total_balance?: string; currency?: string } | null;
  search_error?: string;
  fetch_error?: string;
  chat_error?: string;
};

export type NewsLastRun = {
  id: string;
  status: NewsRunStatus;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  stats: NewsRunStats | null;
  error: string | null;
};

export type NewsOverview = {
  enabled: boolean;
  auto_publish_enabled: boolean;
  dry_run: boolean;
  scan_interval_minutes: number;
  daily_limit: number;
  last_tick_at: string | null;
  next_run_at: string | null;
  last_run: NewsLastRun | null;
  publisher: NewsPublisher | null;
  quota: NewsQuota;
  budget: NewsBudget;
  counts: NewsOverviewCounts;
  costs: {
    today_usd: number;
    month_usd: number;
    today_searches: number;
    today_fetches: number;
    today_tokens_in: number;
    today_tokens_out: number;
  };
  diagnostics: NewsDiagnostics | null;
};

export type NewsRun = {
  id: string;
  status: NewsRunStatus;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  stats: NewsRunStats | null;
  error: string | null;
  cost_usd: number;
};

export type NewsSettings = {
  enabled: boolean;
  scan_interval_minutes: number;
  daily_auto_limit: number;
  auto_publish_enabled: boolean;
  dry_run: boolean;
  max_events_per_run: number;
  max_searches_per_run: number;
  max_article_age_hours: number;
  min_quality_score: number;
  duplicate_title_threshold: number;
  min_media_match: number;
  publisher_user_id: string | null;
  publisher_username: string;
  fast_model: string;
  reasoning_model: string;
  daily_budget_usd: number;
  monthly_budget_usd: number;
  price_input_per_m: number;
  price_output_per_m: number;
  price_search_per_call: number;
  price_fetch_per_call: number;
  notify_enabled: boolean;
  notify_daily_cap: number;
  notify_quiet_start: number;
  notify_quiet_end: number;
  notify_categories: string[];
  worker_url: string;
  last_tick_at: string | null;
  next_run_at: string | null;
  publish_window_start: number;
  publish_window_end: number;
  auto_min_gap_minutes: number;
  // Editoryal kalite ayarları (0133)
  body_format_default: 'auto' | 'short' | 'standard' | 'extended';
  short_min_words: number;
  short_max_words: number;
  standard_min_words: number;
  standard_max_words: number;
  extended_min_words: number;
  extended_max_words: number;
  title_min_chars: number;
  title_max_chars: number;
  spot_min_chars: number;
  spot_max_chars: number;
  preview_lines: number;
  auto_subheads: boolean;
  require_source_verification: boolean;
  quality_check_enabled: boolean;
  source_display_mode: 'card' | 'inline' | 'both';
  reading_min_words: number;
};

export type NewsSettingsProgress = {
  enabled?: boolean;
  scan_interval_minutes?: number;
  daily_auto_limit?: number;
  auto_publish_enabled?: boolean;
  dry_run?: boolean;
  max_events_per_run?: number;
  max_searches_per_run?: number;
  max_article_age_hours?: number;
  min_quality_score?: number;
  duplicate_title_threshold?: number;
  min_media_match?: number;
  publisher_username?: string;
  fast_model?: string;
  reasoning_model?: string;
  daily_budget_usd?: number;
  monthly_budget_usd?: number;
  notify_enabled?: boolean;
  notify_daily_cap?: number;
  notify_quiet_start?: number;
  notify_quiet_end?: number;
  notify_categories?: string[];
  publish_window_start?: number;
  publish_window_end?: number;
  auto_min_gap_minutes?: number;
  body_format_default?: NewsSettings['body_format_default'];
  short_min_words?: number;
  short_max_words?: number;
  standard_min_words?: number;
  standard_max_words?: number;
  extended_min_words?: number;
  extended_max_words?: number;
  title_min_chars?: number;
  title_max_chars?: number;
  spot_min_chars?: number;
  spot_max_chars?: number;
  preview_lines?: number;
  auto_subheads?: boolean;
  require_source_verification?: boolean;
  quality_check_enabled?: boolean;
  source_display_mode?: NewsSettings['source_display_mode'];
  reading_min_words?: number;
};

export type NewsReviewItem = {
  queue_id: string;
  event_id: string;
  title: string;
  spot: string | null;
  category_name: string | null;
  district: string | null;
  risk_level: NewsRiskLevel;
  reasons: string[];
  priority: number;
  state: Exclude<NewsQueueState, 'all'>;
  created_at: string;
  resolved_at: string | null;
  quality_score: number | null;
  independent_sources: number;
  primary_source: boolean;
  media_placeholder: boolean | null;
  published_post_id: string | null;
};

export type NewsReviewList = {
  items: NewsReviewItem[];
  total: number;
};

export type NewsEventDetail = {
  id: string;
  title: string;
  status: string;
  risk_level: NewsRiskLevel;
  category_slug: string;
  district: string | null;
  event_date: string | null;
  summary: string | null;
  primary_source: boolean;
  independent_sources: number;
  conflict: boolean;
  auto_block_reasons: string[];
  created_at: string;
};

export type NewsDraftDetail = {
  id: string;
  version: number;
  title: string;
  spot: string;
  body: string;
  social_copy: string;
  quality_score: number | null;
  plagiarism_score: number | null;
  word_count: number;
  ai_model: string | null;
  status: string;
  updated_at: string;
};

export type NewsVerification = {
  checks: {
    supported?: boolean;
    date_ok?: boolean;
    location_ok?: boolean;
    trabzon_link?: boolean;
    sensitive_flags?: string[];
    notes?: string;
    independent_evidence?: number;
    official_source?: boolean;
    source_domain?: string;
    source_kind?: string;
  };
  conflicts: string[];
  passed: boolean;
  risk_level: NewsRiskLevel;
  model: string | null;
  created_at: string;
};

export type NewsEvidence = {
  domain: string;
  kind: string;
  url: string;
  title: string | null;
  excerpt: string | null;
  facts: unknown;
  is_primary: boolean;
  independent: boolean;
  retrieved_at: string;
};

export type NewsMediaAsset = {
  id: string;
  storage_path: string;
  license_code: string | null;
  license_name: string | null;
  license_reference: string | null;
  attribution: string | null;
  is_placeholder: boolean;
  event_match_score: number | null;
  status: string;
  alt_text: string | null;
  source_url: string | null;
  reject_reason: string | null;
};

export type NewsReviewDetail = {
  event: NewsEventDetail;
  draft: NewsDraftDetail | null;
  queue: {
    id: string;
    reasons: string[];
    priority: number;
    state: string;
    notes: string | null;
    created_at: string;
  } | null;
  publication: {
    id: string;
    post_id: string;
    mode: string;
    status: string;
    published_at: string;
    retracted_at: string | null;
    retract_reason: string | null;
  } | null;
  verification: NewsVerification[];
  evidence: NewsEvidence[];
  media: NewsMediaAsset[];
};

export type NewsReviewAction =
  | 'approve'
  | 'edit_approve'
  | 'reject'
  | 'defer'
  | 'archive'
  | 'retract'
  | 'remove_media'
  | 'move_category';

export type NewsAssistAction =
  | 'rewrite'
  | 'expand'
  | 'recheck_sources'
  | 'find_photo'
  | 'improve_title'
  | 'prepare_spot'
  | 'simplify'
  | 'proofread'
  | 'check_conflicts'
  | 'check_quality'
  | 'social_copy';

export type NewsSourceKind = 'official' | 'trusted_media' | 'unknown' | 'low_trust';

export type NewsSource = {
  id: string;
  name: string;
  domain: string;
  kind: NewsSourceKind;
  feed_url: string | null;
  feed_kind: string;
  media_license_code: string | null;
  license_reference: string | null;
  attribution_text: string | null;
  reliability: number;
  active: boolean;
  notes_tr: string | null;
  last_checked_at: string | null;
  last_error: string | null;
};

export type NewsLicense = {
  code: string;
  name_tr: string;
  commercial_use: boolean;
  derivatives_allowed: boolean;
  attribution_required: boolean;
  requires_documentation: boolean;
  is_usable: boolean;
  license_url: string | null;
  notes_tr: string | null;
};

export type NewsLibraryMediaAsset = {
  id: string;
  event_id: string;
  event_title: string | null;
  storage_path: string;
  source_url: string | null;
  creator: string | null;
  credit: string | null;
  license_code: string;
  license_reference: string | null;
  attribution: string | null;
  is_placeholder: boolean;
  event_match_score: number | null;
  status: string;
  created_at: string;
  removed_at: string | null;
  removal_reason: string | null;
};

export type NewsSourcesResponse = {
  items: NewsSource[];
  licenses: NewsLicense[];
  assets?: NewsLibraryMediaAsset[];
  topics?: { id: string; kind: string; label: string; active: boolean; weight: number }[];
};

export type NewsCostSummary = {
  today: NewsCostSummaryBlock;
  month: NewsCostSummaryBlock;
  published_month: number;
  cost_per_post_usd: number | null;
  budget: NewsBudget;
  note: string;
};

export type NewsErrorItem = {
  id: string;
  run_id: string | null;
  stage: string;
  code: string;
  message: string;
  detail: unknown;
  created_at: string;
};

/** Web tarafında (SSR) kullanılan herkese açık haber modeli. */
export type NewsPublicMedia = {
  storage_path: string;
  is_placeholder: boolean;
  alt_text: string | null;
  credit: string | null;
  license_code: string | null;
  attribution: string | null;
};

export type NewsPublicSource = {
  domain: string;
  kind: string;
  url: string;
  title: string | null;
  retrieved_at: string;
};

export type NewsPublicPost = {
  event_id: string;
  post_id: string;
  slug: string;
  title: string;
  spot: string;
  body: string;
  category_slug: string;
  category_name: string;
  district: string | null;
  event_date: string | null;
  risk_level: NewsRiskLevel;
  ai_generated: boolean;
  ai_model: string | null;
  disclosure: string;
  sources: NewsPublicSource[];
  source_count: number;
  independent_sources: number;
  primary_source: boolean;
  published_at: string;
  updated_at: string;
  last_checked_at: string;
  correction_path: string;
  published_by: string;
  media: NewsPublicMedia | null;
};

export type NewsPublicListItem = {
  slug: string;
  post_id: string;
  title: string;
  spot: string;
  category_slug: string;
  category_name: string;
  district: string | null;
  published_at: string;
  media_path: string | null;
  media_placeholder: boolean;
};

export type NewsPublicList = {
  items: NewsPublicListItem[];
  total: number;
  limit: number;
  offset: number;
};

/** ---------------------------------------------------------------------------
 * Uygulama içi premium haber okuma modeli (`news_post_detail` RPC'si).
 * ------------------------------------------------------------------------- */

export type NewsDetailMedia = {
  id: string;
  storage_path: string;
  thumbnail_path: string | null;
  media_type: 'image' | 'video';
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  display_fit: 'auto' | 'cover' | 'contain';
  alt_text: string | null;
  credit: string | null;
  license_code: string | null;
  attribution: string | null;
  is_placeholder: boolean;
};

export type NewsDetailSource = {
  domain: string;
  kind: string;
  url: string;
  title: string | null;
  retrieved_at: string | null;
  name?: string | null;
};

export type NewsDetail = {
  post_id: string;
  kind: 'ai' | 'source';
  title: string;
  subtitle: string | null;
  summary: string | null;
  lead: string | null;
  body: string;
  body_notice: string | null;
  body_format: 'short' | 'standard' | 'extended' | string;
  word_count: number;
  reading_minutes: number;
  category_slug: string | null;
  category_name: string | null;
  district: string | null;
  published_at: string | null;
  updated_at: string | null;
  published_by: string;
  publisher: {
    username: string;
    display_name: string | null;
    avatar_path: string | null;
    is_verified: boolean;
  };
  ai_generated: boolean;
  disclosure: string | null;
  sources: NewsDetailSource[];
  source_count: number;
  source_card: Record<string, unknown> | null;
  media: NewsDetailMedia[];
  editorial_checks: Record<string, unknown> | null;
  counts: {
    like: number;
    comment: number;
    save: number;
    share: number;
  };
};

export type NewsRelatedItem = {
  post_id: string;
  title: string;
  category_name: string | null;
  district: string | null;
  published_at: string;
  media_path: string | null;
  media_fit: 'auto' | 'cover' | 'contain' | null;
  kind: 'ai' | 'source';
  word_count: number;
};

export type NewsEditorialQueueItem = {
  post_id: string;
  kind: 'ai' | 'source';
  title: string;
  word_count: number;
  body_format: string;
  source_url: string | null;
  source_name: string | null;
  published_at: string;
  needs_review: boolean;
  risk_level: string;
};

export type NewsEditorialQueue = {
  items: NewsEditorialQueueItem[];
};
