import type { AdDestinationType, AdPlacementKey, AdPlatform } from '../types';

export type AdCampaignStatus =
  | 'draft'
  | 'pending_review'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'expired'
  | 'rejected'
  | 'archived';

export type AdTransition = 'submit' | 'approve' | 'reject' | 'pause' | 'resume' | 'archive' | 'to_draft';

export type AdFormat = 'glass_banner' | 'reel_fullscreen' | 'native_card';

export type AdsOverview = {
  ads_enabled: boolean;
  direct_enabled: boolean;
  admob_enabled: boolean;
  active_campaigns: number;
  active_ads: number;
  scheduled_campaigns: number;
  pending_review: number;
  total_campaigns: number;
  impressions_total: number;
  clicks_total: number;
  impressions_today: number;
  clicks_today: number;
  revenue_cents: number;
  placements_enabled: number;
  placements_total: number;
  invalid_events_24h: number;
  reports_7d: number;
  upcoming_ends: { id: string; name: string; ends_at: string; status: AdCampaignStatus }[];
};

export type AdSettings = {
  ads_enabled: boolean;
  direct_enabled: boolean;
  admob_enabled: boolean;
  admob_config: {
    ios_app_id?: string;
    android_app_id?: string;
    units?: Partial<Record<AdPlacementKey, Partial<Record<'ios' | 'android', string>>>>;
  };
  external_domain_allowlist: string[];
  hide_duration_days: number;
  click_rate_limit_per_minute: number;
  impression_rate_limit_per_minute: number;
  min_view_ms: number;
  min_visible_ratio: number;
  serve_ttl_minutes: number;
  auto_pause_report_threshold: number;
  policy_text: string | null;
  updated_at: string;
};

export type AdRule = {
  key: string;
  label_tr: string;
  description_tr: string | null;
  min_value: number;
  max_value: number;
  default_value: number;
  hard_min: number;
  hard_max: number;
};

export type AdPlacementRow = {
  key: AdPlacementKey;
  label_tr: string;
  description_tr: string | null;
  group_key: string;
  surface_status: 'live' | 'reserved';
  surface_note: string | null;
  format: AdFormat;
  supported_formats: AdFormat[];
  enabled: boolean;
  first_after: number;
  interval_min: number;
  interval_max: number;
  max_per_session: number;
  max_daily_per_user: number;
  campaign_repeat_limit: number;
  platforms: AdPlatform[];
  min_priority: number;
  active_from: string | null;
  active_until: string | null;
  allow_admob_fallback: boolean;
  effective: {
    first_after: number;
    interval_min: number;
    interval_max: number;
    max_per_session: number;
    max_daily_per_user: number;
    campaign_repeat_limit: number;
  };
  active_campaigns: number;
  impressions_7d: number;
  clicks_7d: number;
};

export type AdPlacementPatch = Partial<
  Pick<
    AdPlacementRow,
    | 'enabled'
    | 'format'
    | 'first_after'
    | 'interval_min'
    | 'interval_max'
    | 'max_per_session'
    | 'max_daily_per_user'
    | 'campaign_repeat_limit'
    | 'platforms'
    | 'min_priority'
    | 'active_from'
    | 'active_until'
    | 'allow_admob_fallback'
  >
>;

export type AdAdjustment = { field: string; requested: number; applied: number };

export type AdAdvertiser = {
  id: string;
  name: string;
  legal_name: string | null;
  tax_number: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  place_id: string | null;
  place_name?: string | null;
  status: 'active' | 'suspended' | 'archived';
  notes: string | null;
  campaign_count?: number;
  active_campaigns?: number;
  impressions?: number;
  clicks?: number;
  spend_cents?: number;
  members?: { user_id: string; username: string | null; role: string }[];
};

export type AdCampaignListItem = {
  id: string;
  name: string;
  status: AdCampaignStatus;
  priority: number;
  campaign_type: string;
  policy_category: string;
  source: string;
  starts_at: string;
  ends_at: string;
  advertiser_id: string;
  advertiser_name: string;
  title: string | null;
  image_url: string | null;
  destination_type: AdDestinationType | null;
  destination_valid: boolean | null;
  destination_reason: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  spent_cents: number;
  budget_cents: number | null;
  total_impression_cap: number | null;
  target_cities: string[];
  target_districts: string[];
  placements: AdPlacementKey[];
  reports: number;
  updated_at: string;
};

export type AdCampaignList = {
  total: number;
  limit: number;
  offset: number;
  counts: Partial<Record<AdCampaignStatus, number>>;
  items: AdCampaignListItem[];
};

export type AdMetrics = {
  impressions: number;
  clicks: number;
  ctr: number;
  reach: number;
  spend_cents: number;
  invalid_events: number;
  hides: number;
  reports: number;
};

export type AdCampaignFull = {
  id: string;
  advertiser_id: string;
  name: string;
  campaign_type: string;
  policy_category: string;
  status: AdCampaignStatus;
  priority: number;
  starts_at: string;
  ends_at: string;
  daily_impression_cap: number | null;
  total_impression_cap: number | null;
  per_user_daily_cap: number;
  budget_cents: number | null;
  cpm_cents: number | null;
  spent_cents: number;
  target_cities: string[];
  target_districts: string[];
  platforms: AdPlatform[];
  review_note: string | null;
  rejection_reason: string | null;
  updated_at: string;
  advertiser: AdAdvertiser | null;
  creative: {
    title: string;
    description: string | null;
    cta_label: string;
    business_name: string | null;
    image_url: string | null;
    mobile_image_url: string | null;
    web_image_url: string | null;
    video_url: string | null;
    image_focus: 'left' | 'center' | 'right';
  } | null;
  destination: {
    type: AdDestinationType;
    target_id: string | null;
    url: string | null;
    phone: string | null;
    lat: number | null;
    lng: number | null;
    label: string | null;
    is_valid: boolean | null;
    invalid_reason: string | null;
  } | null;
  detail: {
    enabled: boolean;
    headline: string | null;
    cover_url: string | null;
    gallery: string[];
    video_url: string | null;
    body: string | null;
    features: string[];
    price_text: string | null;
    offer_text: string | null;
    address: string | null;
    lat: number | null;
    lng: number | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    valid_until: string | null;
    place_id: string | null;
    listing_type: 'market_listing' | 'real_estate' | null;
    listing_id: string | null;
  } | null;
  placements: AdPlacementKey[];
  metrics: AdMetrics;
  issues: string[];
  feedback: { reason: string | null; details: string | null; created_at: string }[];
  history: { action: string; label: string; at: string; actor: string | null; meta: Record<string, unknown> }[];
};

export type AdCampaignPayload = {
  advertiser_id: string;
  name: string;
  campaign_type: string;
  policy_category: string;
  priority: number;
  starts_at: string;
  ends_at: string;
  daily_impression_cap: number | null;
  total_impression_cap: number | null;
  per_user_daily_cap: number;
  budget_cents: number | null;
  cpm_cents: number | null;
  target_cities: string[];
  target_districts: string[];
  platforms: AdPlatform[];
  placements: AdPlacementKey[];
  creative: {
    title: string;
    description: string | null;
    cta_label: string;
    business_name: string | null;
    image_url: string | null;
    mobile_image_url: string | null;
    web_image_url: string | null;
    video_url: string | null;
    image_focus: 'left' | 'center' | 'right';
  };
  destination: {
    type: AdDestinationType;
    target_id: string | null;
    url: string | null;
    phone: string | null;
    lat: number | null;
    lng: number | null;
    label: string | null;
  };
  detail: NonNullable<AdCampaignFull['detail']> | null;
};

export type AdDailyPoint = { day: string; impressions: number; clicks: number; reach?: number };

export type AdCampaignAnalytics = {
  totals: AdMetrics;
  daily: AdDailyPoint[];
  weekly: { week: string; impressions: number; clicks: number }[];
  monthly: { month: string; impressions: number; clicks: number }[];
  by_placement: { placement: string; label: string | null; impressions: number; clicks: number }[];
  by_district: { district: string; impressions: number }[];
  by_platform: { platform: string; impressions: number }[];
  invalid_by_reason: { kind: string; reason: string; count: number }[];
  reports: { id: string; kind: string; generated_at: string; metrics: AdMetrics }[];
};

export type AdAnalytics = {
  days: number;
  totals: { impressions: number; clicks: number; reach: number; spend_cents: number; invalid_events: number };
  daily: AdDailyPoint[];
  by_placement: { placement: string; label: string; enabled: boolean; impressions: number; clicks: number }[];
  by_district: { district: string; impressions: number }[];
  top_campaigns: { id: string; name: string; status: AdCampaignStatus; impressions: number; clicks: number; ctr: number }[];
};

export type AdTargeting = {
  profile_districts: { district: string; users: number }[];
  profile_cities: { city: string; users: number }[];
  users_without_district: number;
  users_without_city: number;
  campaign_targets: { district: string; campaigns: number }[];
  campaign_city_targets: { city: string; campaigns: number }[];
  untargeted_campaigns: number;
  untargeted_city_campaigns: number;
  impressions_by_district_30d: { district: string; impressions: number }[];
  impressions_by_city_30d: { city: string; impressions: number }[];
};

export type AdMediaAsset = {
  id: string;
  url: string;
  storage_path: string | null;
  media_type: 'image' | 'video';
  variant: 'banner' | 'mobile' | 'web' | 'cover' | 'gallery' | 'video';
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  label: string | null;
  created_at: string;
};

export type AdAuditItem = {
  id: string;
  action: string;
  label: string;
  target_type: string | null;
  target_id: string | null;
  outcome: string;
  meta: Record<string, unknown> | null;
  created_at: string;
  actor: string | null;
  campaign_name: string | null;
};
