export type AdSource = 'trabzone_direct' | 'google_admob';

export type AdPlatform = 'ios' | 'android' | 'web';

/** Uygulamada gerçek bir yüzeye bağlı reklam yerleşimleri. */
export type AdPlacementKey =
  | 'feed_home'
  | 'feed_following'
  | 'feed_nearby'
  | 'feed_popular'
  | 'news_feed'
  | 'news_district'
  | 'marketplace_home'
  | 'marketplace_category'
  | 'real_estate_list'
  | 'vehicle_list'
  | 'job_list'
  | 'business_explore'
  | 'ride_list'
  | 'live_news_feed'
  | 'reels_feed'
  | 'profile_posts'
  | 'future_default';

export type AdDestinationType =
  | 'detail_page'
  | 'business'
  | 'market_listing'
  | 'real_estate'
  | 'vehicle'
  | 'job'
  | 'ride'
  | 'post'
  | 'category'
  | 'external_url'
  | 'phone'
  | 'map_location';

export type AdDestination = {
  type: AdDestinationType;
  target_id: string | null;
  url: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  label: string | null;
  category: {
    slug: string;
    name: string;
    kind: string | null;
    root_slug: string;
    is_child: boolean;
  } | null;
};

export type ServedAd = {
  serve_id: string;
  campaign_id: string;
  source: AdSource;
  advertiser_name: string;
  title: string;
  description: string | null;
  cta_label: string;
  business_name: string | null;
  image_url: string;
  mobile_image_url: string | null;
  web_image_url: string | null;
  image_focus: 'left' | 'center' | 'right';
  destination: AdDestination | null;
};

export type AdServeConfig = {
  first_after: number;
  interval_min: number;
  interval_max: number;
  max_per_session: number;
  format: 'glass_banner' | 'reel_fullscreen' | 'native_card';
  min_view_ms: number;
  min_visible_ratio: number;
};

export type AdFallback = { provider: 'google_admob'; unit_id: string } | null;

export type AdServeResponse = {
  enabled: boolean;
  reason?: string;
  config?: AdServeConfig;
  ads: ServedAd[];
  fallback?: AdFallback;
};

/** Akışa yerleştirilmiş bir reklam hücresi. */
export type AdSlot =
  | {
      kind: 'direct';
      key: string;
      slotIndex: number;
      ad: ServedAd;
      minVisibleRatio: number;
      minViewMs: number;
    }
  | { kind: 'provider'; key: string; slotIndex: number; fallback: NonNullable<AdFallback> };

export type AdFeedbackReason =
  | 'irrelevant'
  | 'repetitive'
  | 'misleading'
  | 'inappropriate'
  | 'scam'
  | 'other';

export type AdDetail = {
  available: boolean;
  reason?: string;
  preview?: boolean;
  campaign?: {
    id: string;
    name: string;
    status: string;
    starts_at: string;
    ends_at: string;
    campaign_type: string;
  };
  advertiser?: { name: string; website: string | null; place_id: string | null };
  creative?: {
    title: string;
    description: string | null;
    cta_label: string;
    business_name: string | null;
    image_url: string | null;
    mobile_image_url: string | null;
    web_image_url: string | null;
    video_url: string | null;
  };
  detail?: {
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
  destination?: AdDestination | null;
  destination_valid?: boolean;
  place?: { id: string; name: string; address: string | null } | null;
  listing?: { type: 'market_listing' | 'real_estate'; id: string; title: string } | null;
};

export const AD_FEEDBACK_REASONS: { key: AdFeedbackReason; label: string }[] = [
  { key: 'irrelevant', label: 'Benimle ilgili değil' },
  { key: 'repetitive', label: 'Çok sık görüyorum' },
  { key: 'misleading', label: 'Yanıltıcı' },
  { key: 'inappropriate', label: 'Uygunsuz içerik' },
  { key: 'scam', label: 'Dolandırıcılık şüphesi' },
  { key: 'other', label: 'Diğer' },
];
