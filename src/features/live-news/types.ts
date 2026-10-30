import type { FeedPost, PostLiveNewsMeta, PostMediaInput } from '@/features/feed/services/feed-service';

// -----------------------------------------------------------------------------
// Kanonik veri modeli
// -----------------------------------------------------------------------------

/**
 * Bir anlık gelişmenin kimliği `posts.id`'dir. `live_news` satırı bu gönderiye
 * 1:1 bağlanır; Reels kaydı da aynı medya dosyalarını işaret eder. Böylece
 * akış, Reels, ilçe akışı, profil ve web sayfası aynı içerik kimliğini kullanır.
 */
export type LiveNewsMeta = PostLiveNewsMeta;

export type LiveNewsItem = FeedPost & {
  live_news: PostLiveNewsMeta;
  distance_km?: number | null;
};

/** Veritabanının kabul ettiği yayın hedefleri. */
export type LiveNewsTarget = 'feed' | 'reels' | 'live' | 'web';

export type LiveNewsCategory =
  | 'guncel'
  | 'trafik'
  | 'hava'
  | 'etkinlik'
  | 'spor'
  | 'guvenlik'
  | 'altyapi';

export type LiveNewsMediaKind = 'text' | 'photo' | 'video' | 'mixed';
export type LiveNewsLocationPrecision = 'none' | 'district' | 'city' | 'approximate';

export type LiveNewsVerificationStatus =
  | 'citizen'
  | 'reviewing'
  | 'verified'
  | 'corrected'
  | 'unverified'
  | 'removed';

export type LiveNewsModerationStatus = 'pending' | 'visible' | 'hidden' | 'removed';

export type LiveNewsRiskLevel = 'low' | 'medium' | 'high';

export type LiveNewsCreateInput = {
  title: string;
  summary: string | null;
  category: LiveNewsCategory;
  district: string | null;
  locationPrecision?: LiveNewsLocationPrecision;
  latitude?: number | null;
  longitude?: number | null;
  media: PostMediaInput[];
  publishTargets?: LiveNewsTarget[];
  usageConsent?: boolean;
  idempotencyKey: string;
};

export type LiveNewsCreateResult = {
  post_id: string;
  canonical_id: string;
  moderation_status: LiveNewsModerationStatus;
  verification_status: LiveNewsVerificationStatus;
  risk_level: LiveNewsRiskLevel;
  risk_flags: string[];
  reel_id: string | null;
  published_at: string | null;
  idempotent?: boolean;
};

/** `live_news_list` filtreleri. */
export type LiveNewsFilter =
  | 'all'
  | 'nearby'
  | 'trabzon'
  | 'districts'
  | 'traffic'
  | 'weather'
  | 'event'
  | 'sports'
  | 'current'
  | 'verified';

export type LiveNewsListParams = {
  filter?: LiveNewsFilter;
  district?: string | null;
  category?: LiveNewsCategory | null;
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number;
  cursor?: string | null;
  limit?: number;
};

export type LiveNewsPage = {
  items: LiveNewsItem[];
  next_cursor: string | null;
  has_more?: boolean;
  latest_at?: string | null;
  requires_location?: boolean;
};

export type AdminLiveNewsState =
  | 'all'
  | 'pending'
  | 'visible'
  | 'hidden'
  | 'removed'
  | 'reviewing'
  | 'verified'
  | 'unverified'
  | 'reported'
  | 'newsroom';

export type AdminLiveNewsParams = {
  state?: AdminLiveNewsState;
  district?: string | null;
  category?: LiveNewsCategory | null;
  query?: string | null;
  limit?: number;
  offset?: number;
};

export type AdminLiveNewsListItem = {
  post_id: string;
  canonical_id: string;
  title: string;
  summary: string | null;
  category: string;
  district: string | null;
  media_kind: LiveNewsMediaKind;
  verification_status: LiveNewsVerificationStatus;
  verification_note: string | null;
  moderation_status: LiveNewsModerationStatus;
  risk_level: LiveNewsRiskLevel;
  risk_flags: string[];
  reports_count: number;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  newsroom_state: string;
  usage_consent: boolean;
  author_id: string;
  author_username: string;
  author_name: string;
  author_avatar_path: string | null;
  media_path: string | null;
  media_type: 'image' | 'video' | null;
  created_at: string;
  published_at: string | null;
};

export type AdminLiveNewsReport = {
  id: string;
  report_no: string | null;
  reason: string;
  status_code: string;
  created_at: string;
};

export type AdminLiveNewsHistoryEntry = {
  id: string;
  action_code: string;
  action_label: string;
  outcome: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type AdminLiveNewsDetail = {
  post: FeedPost;
  live_news: LiveNewsMeta & {
    source_note: string | null;
    editorial_note: string | null;
    moderation_reason: string | null;
    attribution: string | null;
    verified_by: string | null;
    reports: AdminLiveNewsReport[];
    history: AdminLiveNewsHistoryEntry[];
  };
};

export type LiveNewsNotificationPreferences = {
  followed_people: boolean;
  district_updates: boolean;
  verified_only: boolean;
  district: string | null;
};
