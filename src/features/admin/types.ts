/**
 * Trabzone Admin Control Center — shared UI/domain types.
 *
 * Every shape mirrors a SECURITY DEFINER RPC in `supabase/migrations`.
 * The client never reads admin tables directly.
 */

export type AdminMe = {
  is_admin: boolean;
  user_id?: string;
  display_name?: string;
  roles?: string[];
  role_names?: string[];
  permissions?: string[];
};

export type ShellCounts = {
  pending_reports: number;
  critical_reports: number;
  open_tickets: number;
  pending_approvals: number;
  open_errors: number;
  unread_notifications: number;
};

/** Panelde yeni bir işlem düştüğünde gösterilen baloncuğun kaynağı. */
export type AdminAlertCategory =
  | 'report'
  | 'child_safety'
  | 'ticket'
  | 'approval'
  | 'error'
  | 'privacy'
  | 'deletion'
  | 'order'
  | 'ride_verification'
  | 'ride_safety'
  | 'ride_dispute'
  | 'ride_booking'
  | 'content_report'
  | 'custom';

export type AdminAlertTone = 'info' | 'success' | 'warning' | 'danger';

export type AdminAlert = {
  id: string;
  category: AdminAlertCategory;
  title: string;
  body: string | null;
  /** Tıklanınca gidilecek mevcut uygulama rotası. */
  route: string;
  entity_type: string | null;
  entity_id: string | null;
  tone: AdminAlertTone;
  created_at: string;
};

export type AdminAlertFeed = {
  items: AdminAlert[];
  unread: number;
};

export type Paged<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type DateRange = { from: string; to: string };

export type LabelValue = { label: string; value: number };

export type TrendPoint = {
  date: string;
  new_users: number;
  active_users: number;
  posts: number;
  reel_views: number;
  orders: number;
  revenue_cents: number;
};

export type AdminOverview = {
  period: DateRange;
  stats: {
    users_total: number;
    users_new: number;
    users_today: number;
    dau: number;
    wau: number;
    mau: number;
    online_estimate: number;
    posts_total: number;
    posts_period: number;
    posts_today: number;
    reels_total: number;
    reels_created_today: number;
    reels_views_today: number;
    active_listings: number;
    orders_period: number;
    orders_today: number;
    orders_total: number;
    completed_orders: number;
    pending_orders: number;
    pending_reports: number;
    open_tickets: number;
    verified_payment_volume_cents: number;
    revenue_cents: number;
    refunded_cents: number;
    failed_payments: number;
  };
  deltas: {
    users_new: number | null;
    posts: number | null;
    orders: number | null;
    revenue: number | null;
  };
  growth: TrendPoint[];
  countries: LabelValue[];
  cities: LabelValue[];
  platforms: LabelValue[];
  app_versions: LabelValue[];
};

export type AdminUser = {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  avatar_path: string | null;
  is_verified: boolean;
  account_status: string;
  status_label: 'active' | 'suspended' | 'banned' | 'restricted' | 'deleted';
  followers_count: number;
  posts_count: number;
  created_at: string;
  last_seen_at: string | null;
  suspended_until: string | null;
  ban_reason: string | null;
  warning_count: number;
  reels_count: number;
  listings_count: number;
  report_count: number;
};

export type UserFilters = {
  query?: string;
  status?: string | null;
  verified?: boolean | null;
  from?: string | null;
  to?: string | null;
  onlyNew?: boolean;
  limit?: number;
  offset?: number;
};

export type AdminUserDetail = {
  profile: {
    id: string;
    username: string;
    display_name: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    bio: string | null;
    city: string | null;
    district: string | null;
    country_code: string | null;
    website: string | null;
    avatar_path: string | null;
    cover_path: string | null;
    is_verified: boolean;
    account_status: string;
    created_at: string;
    updated_at: string;
    last_seen_at: string | null;
    deletion_requested_at: string | null;
    deletion_scheduled_at: string | null;
    followers_count: number;
    following_count: number;
    posts_count: number;
    suspended_until: string | null;
    ban_reason: string | null;
    warning_count: number;
    last_warning_at: string | null;
  };
  roles: { role_key: string; name: string; granted_at: string; expires_at: string | null }[];
  counts: {
    posts: number;
    reels: number;
    stories: number;
    listings: number;
    orders_buyer: number;
    orders_seller: number;
    reports_against: number;
    reports_filed: number;
    tickets: number;
    messages_sent: number;
  };
  recent_posts: {
    id: string;
    body: string;
    created_at: string;
    moderation_status: string;
    like_count: number;
    comment_count: number;
    media_path: string | null;
  }[];
  recent_reels: {
    id: string;
    caption: string;
    created_at: string;
    moderation_status: string;
    view_count: number;
    cover_path: string | null;
    video_path: string | null;
  }[];
  recent_listings: {
    id: string;
    title: string;
    price_cents: number;
    currency: string;
    status: string;
    moderation_status: string;
    created_at: string;
  }[];
  recent_reports: {
    id: string;
    report_no: string;
    target_type: string;
    target_id: string;
    reason_category: string;
    status_code: string;
    priority: string;
    created_at: string;
  }[];
  recent_actions: {
    id: number;
    action_code: string;
    action_label: string;
    actor_name: string | null;
    created_at: string;
  }[];
};

export type UserAction =
  | 'warn'
  | 'suspend'
  | 'ban'
  | 'restrict'
  | 'reactivate'
  | 'verify'
  | 'unverify'
  | 'remove_avatar'
  | 'request_deletion'
  | 'restore_deleted';

export type ContentPost = {
  id: string;
  body: string | null;
  visibility: string;
  city: string | null;
  moderation_status: string;
  comments_locked: boolean;
  is_featured: boolean;
  like_count: number;
  comment_count: number;
  save_count: number;
  share_count: number;
  created_at: string;
  author_id: string;
  author_username: string;
  author_name: string;
  author_avatar: string | null;
  author_verified: boolean;
  media: { path: string; type: string }[];
  report_count: number;
};

export type ContentReel = {
  id: string;
  caption: string | null;
  cover_path: string | null;
  video_path: string | null;
  duration_ms: number | null;
  audio_title: string | null;
  status: string;
  moderation_status: string;
  comments_locked: boolean;
  is_featured: boolean;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  created_at: string;
  author_id: string;
  author_username: string;
  author_name: string;
  author_avatar: string | null;
  report_count: number;
};

export type ReelTech = { ready: number; processing: number; failed_24h: number };
export type ReelsResponse = Paged<ContentReel> & { tech: ReelTech };

export type ContentStory = {
  id: string;
  caption: string | null;
  media_path: string;
  media_type: string;
  moderation_status: string;
  is_featured: boolean;
  expires_at: string;
  is_active: boolean;
  created_at: string;
  author_id: string;
  author_username: string;
  author_name: string;
  author_avatar: string | null;
  report_count: number;
};

export type StoriesResponse = Paged<ContentStory> & {
  active_count: number;
  retention_hours: number;
};

export type ContentComment = {
  id: string;
  kind: 'post_comment' | 'reel_comment';
  body: string;
  moderation_status: string;
  created_at: string;
  author_id: string;
  author_username: string;
  author_name: string;
  parent_id: string;
  parent_label: string;
  report_count: number;
};

export type ContentKind = 'post' | 'reel' | 'story' | 'comment';
export type ContentAction =
  'hide' | 'restore' | 'remove' | 'lock_comments' | 'unlock_comments' | 'feature' | 'unfeature';

export type MarketplaceOverview = {
  listings: {
    total: number;
    active: number;
    sold: number;
    archived: number;
    removed: number;
    hidden: number;
    reported: number;
  };
  orders: {
    total: number;
    requested: number;
    confirmed: number;
    shipped: number;
    delivered: number;
    completed: number;
    cancelled: number;
    disputes: number;
    pending_payment: number;
  };
  financials: {
    gmv_cents: number;
    commission_cents: number;
    refunded_cents: number;
    paid_orders: number;
    unpaid_orders: number;
  };
  categories: {
    id: string;
    name: string;
    slug: string;
    listing_count: number;
    is_active: boolean;
  }[];
};

export type AdminOrderRow = {
  id: string;
  order_no: string;
  status: string;
  total_cents: number;
  currency: string;
  payment_method: string;
  payment_status: string;
  commission_cents: number;
  refunded_cents: number;
  dispute_status: string;
  created_at: string;
  buyer_username: string;
  seller_username: string;
  first_item: string | null;
  item_count: number;
};

export type AdminOrderDetail = {
  order: {
    id: string;
    order_no: string;
    status: string;
    subtotal_cents: number;
    total_cents: number;
    currency: string;
    payment_method: string;
    payment_status: string;
    commission_bps: number;
    commission_cents: number;
    refunded_cents: number;
    dispute_status: string;
    contact_name: string | null;
    contact_phone: string | null;
    shipping_city: string | null;
    shipping_address: string | null;
    note: string | null;
    created_at: string;
    updated_at: string;
    buyer: {
      id: string;
      username: string;
      display_name: string;
      avatar_path: string | null;
      email: string;
    };
    seller: {
      id: string;
      username: string;
      display_name: string;
      avatar_path: string | null;
      email: string;
    };
  };
  items: {
    id: string;
    listing_id: string;
    title: string;
    image_path: string | null;
    unit_price_cents: number;
    quantity: number;
    line_total_cents: number;
  }[];
  refunds: {
    id: string;
    amount_cents: number;
    status: string;
    reason: string;
    created_at: string;
    decided_at: string | null;
    decided_by_name: string | null;
  }[];
  timeline: {
    action_code: string;
    action_label: string;
    actor_name: string | null;
    created_at: string;
    metadata: Record<string, unknown>;
  }[];
};

export type OrderAction =
  | 'confirm'
  | 'ship'
  | 'deliver'
  | 'complete'
  | 'cancel'
  | 'reject'
  | 'refund'
  | 'dispute_open'
  | 'dispute_resolve'
  | 'dispute_reject';

export type CommissionSetting = {
  id: string;
  category_id: string | null;
  category_name: string | null;
  rate_bps: number;
  effective_from: string;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
};

export type FinanceOverview = {
  period: DateRange;
  stats: {
    gross_cents: number;
    premium_cents: number;
    marketplace_cents: number;
    commission_cents: number;
    refunded_cents: number;
    net_cents: number;
    failed_payments: number;
    pending_payments: number;
    paid_transactions: number;
    active_subscriptions: number;
    canceled_subscriptions: number;
    arpu_cents: number;
  };
  series: {
    date: string;
    premium_cents: number;
    marketplace_cents: number;
    commission_cents: number;
    refund_cents: number;
  }[];
  recent: {
    id: string;
    kind: string;
    reference: string;
    user_name: string | null;
    amount_cents: number;
    currency: string;
    status: string;
    provider: string;
    created_at: string;
  }[];
};

export type FinanceTransaction = {
  id: string;
  kind: string;
  reference: string;
  user_name: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  provider: string;
  created_at: string;
};

export type MessagingOverview = {
  period: DateRange;
  stats: {
    messages_period: number;
    messages_today: number;
    active_conversations: number;
    media_messages: number;
    undelivered: number;
    avg_delivery_seconds: number;
    calls_period: number;
    failed_calls: number;
    blocked_events: number;
    open_message_reports: number;
    upload_errors_24h: number;
    notifications_24h: number;
  };
  series: { date: string; messages: number }[];
  report_reasons: LabelValue[];
};

export type MessageReport = {
  id: string;
  report_no: string;
  target_type: string;
  target_id: string;
  reason_category: string;
  description: string | null;
  priority: string;
  status_code: string;
  is_child_safety: boolean;
  created_at: string;
  sla_due_at: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  reporter_ref: string;
  has_snapshot: boolean;
};

export type MessageReportDetail = {
  report: {
    id: string;
    report_no: string;
    target_type: string;
    target_id: string;
    reason_category: string;
    description: string | null;
    priority: string;
    status_code: string;
    is_child_safety: boolean;
    created_at: string;
    snapshot: Record<string, unknown>;
  };
  message: {
    id: string;
    conversation_id: string;
    sender_id: string;
    kind: string;
    body: string | null;
    media_path: string | null;
    created_at: string;
    deleted_at: string | null;
  } | null;
  conversation: {
    id: string;
    kind: string;
    title: string | null;
    member_count: number;
  } | null;
  access_logged: boolean;
};

export type Campaign = {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  route: string | null;
  audience: { type: string; value?: string };
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
  scheduled_at: string | null;
  sent_at: string | null;
  target_count: number;
  sent_count: number;
  failed_count: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type CampaignList = Paged<Campaign> & {
  stats: {
    draft: number;
    scheduled: number;
    sent: number;
    sent_30d: number;
    delivered_30d: number;
    failed_30d: number;
  };
};

export type CmsPageSummary = {
  slug: string;
  title: string;
  locale: string;
  status: 'draft' | 'published' | 'archived';
  version: number;
  published_at: string | null;
  updated_at: string;
  updated_by_name: string | null;
  excerpt: string;
};

export type CmsPage = {
  slug: string;
  title: string;
  body: string;
  locale: string;
  status: 'draft' | 'published' | 'archived';
  version: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  versions: {
    version: number;
    title: string;
    status: string;
    created_at: string;
    created_by_name: string | null;
  }[];
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  level: 'info' | 'warning' | 'critical';
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  live: boolean;
  created_at: string;
  created_by_name: string | null;
};

export type AnnouncementList = {
  items: Announcement[];
  stats: { active: number; live: number; scheduled: number };
};

export type AppSetting = {
  key: string;
  value: unknown;
  description: string | null;
  is_public: boolean;
  updated_at: string;
  updated_by_name: string | null;
};

export type FeatureFlag = {
  key: string;
  label: string;
  description: string | null;
  category: string;
  enabled: boolean;
  is_public: boolean;
  critical: boolean;
  rollout_note: string | null;
  updated_at: string;
  updated_by_name: string | null;
};

export type ApprovalRequest = {
  id: string;
  action_code: string;
  target_id: string;
  payload: Record<string, unknown>;
  reason: string;
  requested_by_name: string | null;
  created_at: string;
};

export type FeatureFlagsResponse = {
  items: FeatureFlag[];
  pending_approvals: ApprovalRequest[];
};

export type RoleOverview = {
  permissions: { code: string; description: string }[];
  roles: {
    key: string;
    name: string;
    description: string | null;
    rank: number;
    permissions: string[];
    user_count: number;
  }[];
  staff: {
    user_id: string;
    display_name: string;
    username: string;
    roles: string[];
    is_super_admin: boolean;
    last_seen_at: string | null;
  }[];
};

export type StaffMember = {
  user_id: string;
  display_name: string;
  username: string;
  email: string;
  roles: string[];
  last_seen_at: string | null;
  active_sessions: number;
};

export type SecurityOverview = {
  mfa_required: boolean;
  session_hours: number;
  current_session_id: string | null;
  stats: {
    active_sessions: number;
    revoked_sessions_7d: number;
    failed_logins_24h: number;
    rate_limit_hits_24h: number;
    open_critical_reports: number;
    suspended_accounts: number;
    unverified_staff_sessions: number;
  };
  signals: {
    user_id: string;
    display_name: string;
    username: string;
    message_count: number;
    report_count: number;
    signal: string;
  }[];
  events: {
    id: number;
    action_code: string;
    action_label: string;
    actor_name: string | null;
    target_type: string | null;
    created_at: string;
  }[];
};

export type AdminSession = {
  session_id: string;
  user_id: string;
  display_name: string | null;
  username: string | null;
  user_agent: string | null;
  ip_masked: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  is_current: boolean;
};

export type SystemHealth = {
  database: { size_bytes: number; tables: number; server_time: string };
  storage: {
    size_bytes: number;
    objects: number;
    buckets: { bucket_id: string; objects: number; size_bytes: number }[];
  };
  errors: {
    open: number;
    last_24h: number;
    recent: {
      id: string;
      severity: string;
      source: string;
      error_code: string;
      message: string;
      occurred_at: string;
      resolved_at: string | null;
    }[];
  };
  reels: { processing: number; failed_24h: number; ready: number };
  integrations: {
    key: string;
    label: string;
    status: string;
    detail: string | null;
    last_checked_at: string | null;
  }[];
  counts: Record<string, number>;
  app_versions: LabelValue[];
  platforms: LabelValue[];
};

export type AuditEntry = {
  id: number;
  action_code: string;
  action_label: string;
  target_type: string | null;
  target_id: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
  actor_name: string | null;
  created_at: string;
};

export type AuditResponse = Paged<AuditEntry> & {
  actions: string[];
  targets: string[];
};

export type ReportCatalogItem = {
  key: string;
  title: string;
  description: string;
  category: string;
  columns: { key: string; label: string; width: number }[];
  filters: Record<string, string>;
  sensitive: boolean;
  required_permissions: string[];
};

export type ReportCatalogResponse = {
  items: ReportCatalogItem[];
  categories: string[];
};

export type ReportPreview = {
  columns: { key: string; label: string; width: number }[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
};

export type SupportTemplate = {
  id: string;
  title: string;
  category: string | null;
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
};
