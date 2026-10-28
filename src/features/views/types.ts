/** Tekil görüntüleme sisteminin istemci tipleri. */

export type ViewContentType =
  | 'post'
  | 'reel'
  | 'marketplace_listing'
  | 'real_estate_listing'
  | 'place'
  | 'ride_offer'
  | 'profile'
  | 'blog_post';

export type ViewRegistration = {
  type: ViewContentType;
  id: string;
  /** Hangi yüzeyden sayıldığı (feed, detail, reels …) — yalnızca teşhis amaçlı. */
  surface?: string;
};

export type ViewRegisterResult = {
  counted: boolean;
  reason: string | null;
  uniqueViews: number;
};

export type ViewCountResult = {
  type: ViewContentType;
  id: string;
  uniqueViews: number;
  legacyViews: number;
};

export type ViewSettings = {
  min_visible_ratio: number;
  min_visible_ms: number;
  video_min_play_ms: number;
  batch_window_ms: number;
  rate_limit_per_minute: number;
  daily_active_retention_days: number;
  enabled: boolean;
  updated_at?: string | null;
};

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  min_visible_ratio: 0.5,
  min_visible_ms: 1000,
  video_min_play_ms: 2000,
  batch_window_ms: 1200,
  rate_limit_per_minute: 150,
  daily_active_retention_days: 400,
  enabled: true,
};

export type ViewOwnerStats = {
  content_type: ViewContentType;
  content_id: string;
  unique_views: number;
  legacy_views: number;
  legacy_label: string | null;
  counted_since: string;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  metrics: {
    like_count?: number;
    comment_count?: number;
    save_count?: number;
    share_count?: number;
    rating_avg?: number | string | null;
    created_at?: string;
  };
  series: { date: string; views: number }[];
};

export type AdminViewTypeBreakdown = {
  content_type: ViewContentType;
  label: string;
  views: number;
  contents: number;
};

export type AdminViewTopItem = {
  id: string;
  title: string;
  unique_views: number;
  legacy_views?: number;
  author_username?: string | null;
  is_news?: boolean;
};

export type AdminViewAnalytics = {
  generated_at: string;
  today: { views: number; accounts: number };
  week: { views: number; accounts: number };
  month: { views: number; accounts: number };
  lifetime: { views: number; accounts: number; records: number };
  by_type: AdminViewTypeBreakdown[];
  daily_series: { date: string; views: number }[];
  top_posts: AdminViewTopItem[];
  top_news: AdminViewTopItem[];
  top_marketplace: AdminViewTopItem[];
  top_reels: AdminViewTopItem[];
  top_places: AdminViewTopItem[];
  suspicious: { user_id: string; username: string | null; views: number }[];
  errors: {
    id: number;
    content_type: string | null;
    content_id: string | null;
    error_code: string;
    message: string | null;
    created_at: string;
  }[];
  settings: ViewSettings;
};
