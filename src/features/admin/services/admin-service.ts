import type { PostgrestError } from '@supabase/supabase-js';

import { appError, type AppError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  AdminMe,
  AdminOrderDetail,
  AdminOrderRow,
  AdminSession,
  AdminUser,
  AdminUserDetail,
  AdminOverview,
  Announcement,
  AnnouncementList,
  AppSetting,
  AuditResponse,
  Campaign,
  CampaignList,
  CmsPage,
  CmsPageSummary,
  CommissionSetting,
  ContentAction,
  ContentComment,
  ContentKind,
  ContentPost,
  FeatureFlagsResponse,
  FinanceOverview,
  FinanceTransaction,
  MarketplaceOverview,
  MessageReport,
  MessageReportDetail,
  MessagingOverview,
  OrderAction,
  Paged,
  ReportCatalogResponse,
  ReportPreview,
  ReelsResponse,
  RoleOverview,
  SecurityOverview,
  ShellCounts,
  StaffMember,
  StoriesResponse,
  SupportTemplate,
  SystemHealth,
  UserAction,
  UserFilters,
} from '../types';

/**
 * Admin RPC client. The browser never touches admin tables: every read and
 * write goes through a SECURITY DEFINER function that re-checks permissions.
 */

export const adminKeys = {
  me: ['admin', 'me'] as const,
  shell: ['admin', 'shell'] as const,
  overview: (range: { from: string; to: string }) => ['admin', 'overview', range] as const,
  users: (filters: UserFilters) => ['admin', 'users', filters] as const,
  user: (id: string) => ['admin', 'user', id] as const,
  posts: (params: unknown) => ['admin', 'posts', params] as const,
  reels: (params: unknown) => ['admin', 'reels', params] as const,
  stories: (params: unknown) => ['admin', 'stories', params] as const,
  comments: (params: unknown) => ['admin', 'comments', params] as const,
  market: ['admin', 'market'] as const,
  orders: (params: unknown) => ['admin', 'orders', params] as const,
  order: (id: string) => ['admin', 'order', id] as const,
  commissions: ['admin', 'commissions'] as const,
  finance: (range: { from: string; to: string }) => ['admin', 'finance', range] as const,
  financeTx: (params: unknown) => ['admin', 'finance-tx', params] as const,
  messaging: (range: { from: string; to: string }) => ['admin', 'messaging', range] as const,
  messageReports: (queue: string) => ['admin', 'message-reports', queue] as const,
  messageReport: (id: string) => ['admin', 'message-report', id] as const,
  campaigns: (params: unknown) => ['admin', 'campaigns', params] as const,
  audience: (audience: unknown) => ['admin', 'audience', audience] as const,
  cmsPages: (params: unknown) => ['admin', 'cms', params] as const,
  cmsPage: (slug: string) => ['admin', 'cms-page', slug] as const,
  announcements: ['admin', 'announcements'] as const,
  settings: ['admin', 'settings'] as const,
  flags: ['admin', 'flags'] as const,
  roles: ['admin', 'roles'] as const,
  staff: ['admin', 'staff'] as const,
  security: ['admin', 'security'] as const,
  sessions: ['admin', 'sessions'] as const,
  system: ['admin', 'system'] as const,
  audit: (params: unknown) => ['admin', 'audit', params] as const,
  reportCatalog: ['admin', 'report-catalog'] as const,
  reportPreview: (params: unknown) => ['admin', 'report-preview', params] as const,
  supportTemplates: ['admin', 'support-templates'] as const,
  mfa: ['admin', 'mfa'] as const,
  alerts: ['admin', 'alerts'] as const,
};

const TOKENS: Record<string, { code: Parameters<typeof appError>[0]; message: string }> = {
  not_authenticated: { code: 'forbidden', message: 'Oturum bulunamadı. Tekrar giriş yap.' },
  insufficient_privilege: { code: 'forbidden', message: 'Bu işlem için yetkin yok.' },
  reason_required: { code: 'invalid_input', message: 'İşlem gerekçesi en az 3 karakter olmalı.' },
  reason_too_short: { code: 'invalid_input', message: 'İşlem gerekçesi en az 3 karakter olmalı.' },
  invalid_date_range: { code: 'invalid_input', message: 'Başlangıç tarihi bitişten önce olmalı.' },
  date_range_too_large: { code: 'invalid_input', message: 'Tarih aralığı çok geniş.' },
  invalid_status: { code: 'invalid_input', message: 'Geçersiz durum seçimi.' },
  invalid_action: { code: 'invalid_input', message: 'Bu işlem bu kayıt için geçerli değil.' },
  invalid_transition: { code: 'invalid_input', message: 'Sipariş bu adıma geçirilemez.' },
  invalid_user: { code: 'invalid_input', message: 'Kullanıcı bulunamadı.' },
  user_not_found: { code: 'not_found', message: 'Kullanıcı bulunamadı.' },
  content_not_found: { code: 'not_found', message: 'İçerik bulunamadı veya kaldırılmış.' },
  order_not_found: { code: 'not_found', message: 'Sipariş bulunamadı.' },
  report_not_found: { code: 'not_found', message: 'Şikâyet bulunamadı.' },
  page_not_found: { code: 'not_found', message: 'Sayfa bulunamadı.' },
  template_not_found: { code: 'not_found', message: 'Şablon bulunamadı.' },
  campaign_not_found: { code: 'not_found', message: 'Kampanya bulunamadı.' },
  feature_not_found: { code: 'not_found', message: 'Özellik bulunamadı.' },
  setting_not_found: { code: 'not_found', message: 'Ayar bulunamadı.' },
  session_not_found: { code: 'not_found', message: 'Oturum bulunamadı.' },
  approval_not_found: { code: 'not_found', message: 'Onay talebi bulunamadı.' },
  invalid_refund_amount: { code: 'invalid_input', message: 'İade tutarı sipariş bakiyesini aşıyor.' },
  payment_not_collected: { code: 'invalid_input', message: 'Tahsil edilmemiş sipariş iade edilemez.' },
  campaign_has_no_recipients: { code: 'invalid_input', message: 'Bu hedef kitlede alıcı yok.' },
  campaign_already_sent: { code: 'duplicate', message: 'Bu kampanya zaten gönderildi.' },
  campaign_immutable_after_send: { code: 'forbidden', message: 'Gönderilen kampanya değiştirilemez.' },
  campaign_cannot_be_cancelled: { code: 'invalid_input', message: 'Bu kampanya iptal edilemez.' },
  title_length_invalid: { code: 'invalid_input', message: 'Başlık uzunluğu geçersiz.' },
  body_length_invalid: { code: 'invalid_input', message: 'Metin uzunluğu geçersiz.' },
  body_too_long: { code: 'invalid_input', message: 'Metin çok uzun.' },
  route_invalid: { code: 'invalid_input', message: 'Hedef ekran yolu "/" ile başlamalı.' },
  image_url_invalid: { code: 'invalid_input', message: 'Görsel adresi geçerli değil.' },
  slug_invalid: { code: 'invalid_input', message: 'Sayfa adresi yalnızca küçük harf, rakam ve tire içerebilir.' },
  locale_invalid: { code: 'invalid_input', message: 'Dil kodu geçersiz (örn. tr, en).' },
  end_before_start: { code: 'invalid_input', message: 'Bitiş tarihi başlangıçtan sonra olmalı.' },
  level_invalid: { code: 'invalid_input', message: 'Duyuru seviyesi geçersiz.' },
  audience_value_required: { code: 'invalid_input', message: 'Bu hedef kitle için değer gerekli.' },
  unsupported_audience_type: { code: 'invalid_input', message: 'Desteklenmeyen hedef kitle.' },
  invalid_commission: { code: 'invalid_input', message: 'Komisyon oranı 0-50% aralığında olmalı.' },
  super_admin_immutable: { code: 'forbidden', message: 'Super Admin izinleri değiştirilemez.' },
  unknown_role: { code: 'invalid_input', message: 'Rol bulunamadı.' },
  role_not_found: { code: 'not_found', message: 'Rol bulunamadı.' },
  cannot_revoke_self: { code: 'forbidden', message: 'Kendi yönetici rolünü kaldıramazsın.' },
  last_super_admin: { code: 'forbidden', message: 'Son Super Admin kaldırılamaz.' },
  invalid_permissions: { code: 'invalid_input', message: 'Geçersiz yetki seçimi.' },
  report_not_found_or_forbidden: { code: 'forbidden', message: 'Rapor bulunamadı veya yetkin yok.' },
};

export function mapAdminError(error: PostgrestError | Error | null | undefined): AppError {
  if (!error) {
    return appError('unknown');
  }
  const raw = 'message' in error ? (error.message ?? '').trim() : '';
  const token = raw.split(/\s/)[0] ?? '';
  const known = TOKENS[token];
  if (known) {
    return appError(known.code, known.message);
  }
  return rpcError(error as PostgrestError);
}

export function adminErrorText(error: unknown): string {
  if (!error) {
    return 'İşlem tamamlanamadı.';
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) {
    return fail(mapAdminError(error));
  }
  return ok(data as unknown as T);
}

// ---------------------------------------------------------------------------
// Identity, shell badges, dashboard
// ---------------------------------------------------------------------------

export const fetchAdminMe = () => rpc<AdminMe>('admin_me');
export const fetchShellCounts = () => rpc<ShellCounts>('admin_shell_counts');

export const fetchOverview = (from: string, to: string) =>
  rpc<AdminOverview>('admin_overview_live', { p_from: from, p_to: to });

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const fetchUsers = (filters: UserFilters) =>
  rpc<Paged<AdminUser>>('admin_users_list', {
    p_query: filters.query ?? null,
    p_status: filters.status ?? null,
    p_verified: filters.verified ?? null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_only_new: filters.onlyNew ?? false,
    p_limit: filters.limit ?? 25,
    p_offset: filters.offset ?? 0,
  });

export const fetchUserDetail = (userId: string) =>
  rpc<AdminUserDetail>('admin_user_detail', { p_user_id: userId });

export const userAction = (
  userId: string,
  action: UserAction,
  reason: string | null,
  days: number | null = null,
) =>
  rpc<Record<string, unknown>>('admin_user_action', {
    p_user_id: userId,
    p_action: action,
    p_reason: reason,
    p_days: days,
  });

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export const fetchPosts = (params: {
  query?: string;
  status?: string | null;
  featured?: boolean | null;
  limit?: number;
  offset?: number;
}) =>
  rpc<Paged<ContentPost>>('admin_posts_list', {
    p_query: params.query ?? null,
    p_status: params.status ?? null,
    p_author: null,
    p_featured: params.featured ?? null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  });

export const fetchReels = (params: {
  query?: string;
  status?: string | null;
  moderation?: string | null;
  limit?: number;
  offset?: number;
}) =>
  rpc<ReelsResponse>('admin_reels_list', {
    p_query: params.query ?? null,
    p_status: params.status ?? null,
    p_moderation: params.moderation ?? null,
    p_author: null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  });

export const fetchStories = (params: {
  query?: string;
  status?: string | null;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}) =>
  rpc<StoriesResponse>('admin_stories_list', {
    p_query: params.query ?? null,
    p_status: params.status ?? null,
    p_active_only: params.activeOnly ?? false,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  });

export const fetchComments = (params: {
  query?: string;
  status?: string | null;
  limit?: number;
  offset?: number;
}) =>
  rpc<Paged<ContentComment>>('admin_comments_list', {
    p_query: params.query ?? null,
    p_status: params.status ?? null,
    p_limit: params.limit ?? 30,
    p_offset: params.offset ?? 0,
  });

export const contentAction = (
  kind: ContentKind,
  id: string,
  action: ContentAction,
  reason: string | null,
) =>
  rpc<Record<string, unknown>>('admin_content_action', {
    p_kind: kind,
    p_id: id,
    p_action: action,
    p_reason: reason,
  });

// ---------------------------------------------------------------------------
// Marketplace & finance
// ---------------------------------------------------------------------------

export const fetchMarketplaceOverview = () =>
  rpc<MarketplaceOverview>('admin_marketplace_overview');

export const fetchOrders = (params: {
  status?: string | null;
  query?: string | null;
  payment?: string | null;
  limit?: number;
  offset?: number;
}) =>
  rpc<Paged<AdminOrderRow>>('admin_orders_table', {
    p_status: params.status ?? null,
    p_query: params.query ?? null,
    p_payment: params.payment ?? null,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  });

export const fetchOrderDetail = (orderId: string) =>
  rpc<AdminOrderDetail>('admin_order_detail', { p_order_id: orderId });

export const orderAction = (
  orderId: string,
  action: OrderAction,
  reason: string | null,
  amountCents: number | null = null,
) =>
  rpc<Record<string, unknown>>('admin_order_action', {
    p_order_id: orderId,
    p_action: action,
    p_reason: reason,
    p_amount_cents: amountCents,
  });

export const fetchCommissionSettings = () =>
  rpc<{ items: CommissionSetting[]; current_global_bps: number }>(
    'admin_commission_settings_list',
  );

export const setCommission = (rateBps: number, categoryId: string | null, reason: string) =>
  rpc<Record<string, unknown>>('admin_commission_set', {
    p_rate_bps: rateBps,
    p_category_id: categoryId,
    p_reason: reason,
  });

export const fetchFinanceOverview = (from: string, to: string) =>
  rpc<FinanceOverview>('admin_finance_overview', { p_from: from, p_to: to });

export const fetchFinanceTransactions = (params: {
  kind?: string;
  status?: string;
  from: string;
  to: string;
  limit?: number;
  offset?: number;
}) =>
  rpc<Paged<FinanceTransaction>>('admin_finance_transactions', {
    p_kind: params.kind ?? 'all',
    p_status: params.status ?? null,
    p_from: params.from,
    p_to: params.to,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  });

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export const fetchMessagingOverview = (from: string, to: string) =>
  rpc<MessagingOverview>('admin_messaging_overview', { p_from: from, p_to: to });

export const fetchMessageReports = (queue: string, limit = 20, offset = 0) =>
  rpc<Paged<MessageReport>>('admin_message_reports', {
    p_queue: queue,
    p_limit: limit,
    p_offset: offset,
  });

export const fetchMessageReportDetail = (reportId: string, reason: string) =>
  rpc<MessageReportDetail>('admin_message_report_detail', {
    p_report_id: reportId,
    p_reason: reason,
  });

// ---------------------------------------------------------------------------
// Notification campaigns
// ---------------------------------------------------------------------------

export const fetchCampaigns = (
  status: string | null,
  search: string,
  limit = 25,
  offset = 0,
) =>
  rpc<CampaignList>('admin_campaigns_list', {
    p_status: status,
    p_search: search || null,
    p_limit: limit,
    p_offset: offset,
  });

export const previewAudience = (audience: Record<string, unknown>) =>
  rpc<{ count: number; capped: boolean }>('admin_campaign_audience_preview', {
    p_audience: audience,
  });

export const saveCampaign = (input: {
  id?: string | null;
  title: string;
  body: string;
  imageUrl?: string | null;
  route?: string | null;
  audience: { type: string; value?: string };
  scheduledAt?: string | null;
  sendNow: boolean;
  reason?: string | null;
}) =>
  rpc<Campaign>('admin_campaign_save', {
    p_id: input.id ?? null,
    p_title: input.title,
    p_body: input.body,
    p_image_url: input.imageUrl ?? null,
    p_route: input.route ?? null,
    p_audience: input.audience,
    p_scheduled_at: input.scheduledAt ?? null,
    p_send_now: input.sendNow,
    p_reason: input.reason ?? null,
  });

export const cancelCampaign = (id: string, reason: string) =>
  rpc<{ id: string; status: string }>('admin_campaign_cancel', { p_id: id, p_reason: reason });

// ---------------------------------------------------------------------------
// CMS & announcements
// ---------------------------------------------------------------------------

export const fetchCmsPages = (search: string, status: string | null, limit = 50, offset = 0) =>
  rpc<Paged<CmsPageSummary>>('admin_cms_pages_list', {
    p_search: search || null,
    p_status: status,
    p_limit: limit,
    p_offset: offset,
  });

export const fetchCmsPage = (slug: string) => rpc<CmsPage>('admin_cms_page_get', { p_slug: slug });

export const saveCmsPage = (input: {
  slug: string;
  title: string;
  body: string;
  locale: string;
  publish: boolean;
  reason: string;
}) =>
  rpc<CmsPage>('admin_cms_page_save', {
    p_slug: input.slug,
    p_title: input.title,
    p_body: input.body,
    p_locale: input.locale,
    p_publish: input.publish,
    p_reason: input.reason,
  });

export const archiveCmsPage = (slug: string, reason: string) =>
  rpc<{ slug: string; status: string }>('admin_cms_page_archive', { p_slug: slug, p_reason: reason });

export const fetchAnnouncements = () => rpc<AnnouncementList>('admin_announcements_list');

export const saveAnnouncement = (input: {
  id?: string | null;
  title: string;
  body: string;
  level: string;
  startsAt: string;
  endsAt?: string | null;
  isActive: boolean;
  reason: string;
}) =>
  rpc<Announcement>('admin_announcement_save', {
    p_id: input.id ?? null,
    p_title: input.title,
    p_body: input.body,
    p_level: input.level,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt ?? null,
    p_is_active: input.isActive,
    p_reason: input.reason,
  });

export const toggleAnnouncement = (id: string, active: boolean, reason: string) =>
  rpc<{ id: string; is_active: boolean }>('admin_announcement_toggle', {
    p_id: id,
    p_active: active,
    p_reason: reason,
  });

// ---------------------------------------------------------------------------
// Settings, feature flags, approvals
// ---------------------------------------------------------------------------

export const fetchSettings = () =>
  rpc<{ items: AppSetting[] }>('admin_settings_get').then((result) =>
    result.ok ? ok(result.data.items) : fail<AppSetting[]>(result.error),
  );

export const setSetting = (key: string, value: unknown, reason: string) =>
  rpc<Record<string, unknown>>('admin_settings_set', {
    p_key: key,
    p_value: value,
    p_reason: reason,
  });

export const fetchFeatureFlags = () =>
  rpc<FeatureFlagsResponse>('admin_feature_flags_list');

export const setFeatureFlag = (key: string, enabled: boolean, reason: string) =>
  rpc<Record<string, unknown> & { approval_required?: boolean; approval_id?: string }>(
    'admin_feature_flag_set',
    { p_key: key, p_enabled: enabled, p_reason: reason },
  );

export const decideApproval = (approvalId: string, approve: boolean, reason: string) =>
  rpc<Record<string, unknown>>('admin_approval_decide', {
    p_approval_id: approvalId,
    p_approve: approve,
    p_reason: reason,
  });

// ---------------------------------------------------------------------------
// Roles, staff, security, system
// ---------------------------------------------------------------------------

export const fetchRoleOverview = () => rpc<RoleOverview>('admin_roles_overview');
export const setRolePermissions = (roleKey: string, permissions: string[], reason: string) =>
  rpc<Record<string, unknown>>('admin_role_permissions_set', {
    p_role_key: roleKey,
    p_permissions: permissions,
    p_reason: reason,
  });
export const revokeRole = (userId: string, roleKey: string, reason: string) =>
  rpc<Record<string, unknown>>('admin_revoke_role', {
    p_user_id: userId,
    p_role_key: roleKey,
    p_reason: reason,
  });

export const fetchStaff = () =>
  rpc<{ items: StaffMember[] }>('admin_staff_list').then((result) =>
    result.ok ? ok(result.data.items) : fail<StaffMember[]>(result.error),
  );

export const assignRole = (userId: string, roleKey: string) =>
  rpc<Record<string, unknown>>('admin_assign_role', {
    p_user_id: userId,
    p_role_key: roleKey,
  });

export type FoundUser = {
  user_id: string;
  display_name: string;
  username: string;
  email: string;
  account_status: string;
};

export const findUser = (query: string) =>
  rpc<FoundUser[]>('admin_find_user', { p_query: query });

export const fetchSecurityOverview = () => rpc<SecurityOverview>('admin_security_overview');

export const touchSession = (userAgent?: string | null) =>
  rpc<{ tracked: boolean; session_id?: string; reason?: string }>('admin_touch_session', {
    p_user_agent: userAgent ?? null,
  });

export const logoutSession = () =>
  rpc<{ revoked: boolean; session_id?: string; reason?: string }>('admin_logout_session', {});

export const fetchSessions = () =>
  rpc<{ current_session_id: string | null; items: AdminSession[] }>('admin_sessions_list');

export const revokeSession = (sessionId: string, reason: string) =>
  rpc<Record<string, unknown>>('admin_revoke_session', {
    p_session_id: sessionId,
    p_reason: reason,
  });

export const fetchSystemHealth = () => rpc<SystemHealth>('admin_system_health');

// ---------------------------------------------------------------------------
// Audit + analytics reports
// ---------------------------------------------------------------------------

export const fetchAuditCenter = (params: {
  actionCode?: string | null;
  targetType?: string | null;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) =>
  rpc<AuditResponse>('admin_audit_center', {
    p_action_code: params.actionCode ?? null,
    p_target_type: params.targetType ?? null,
    p_search: params.search || null,
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_limit: params.limit ?? 40,
    p_offset: params.offset ?? 0,
  });

export const fetchReportCatalog = () => rpc<ReportCatalogResponse>('admin_report_catalog');

export const previewReport = (input: {
  key: string;
  from: string;
  to: string;
  filters?: Record<string, string>;
  limit?: number;
  offset?: number;
}) =>
  rpc<ReportPreview>('admin_report_query', {
    p_key: input.key,
    p_from: input.from,
    p_to: input.to,
    p_filters: input.filters ?? {},
    p_limit: input.limit ?? 25,
    p_offset: input.offset ?? 0,
  });

export const exportReportRows = (
  key: string,
  from: string,
  to: string,
  filters: Record<string, string> = {},
) =>
  rpc<ReportPreview>('admin_report_export_query', {
    p_key: key,
    p_from: from,
    p_to: to,
    p_filters: filters,
    p_limit: 5000,
    p_offset: 0,
  });

// ---------------------------------------------------------------------------
// Support templates
// ---------------------------------------------------------------------------

export const fetchSupportTemplates = () =>
  rpc<{ items: SupportTemplate[] }>('admin_support_templates_list').then((result) =>
    result.ok ? ok(result.data.items) : fail<SupportTemplate[]>(result.error),
  );

export const saveSupportTemplate = (input: {
  id?: string | null;
  title: string;
  category?: string | null;
  body: string;
  isActive: boolean;
  reason?: string | null;
}) =>
  rpc<SupportTemplate>('admin_support_template_save', {
    p_id: input.id ?? null,
    p_title: input.title,
    p_category: input.category ?? null,
    p_body: input.body,
    p_is_active: input.isActive,
    p_reason: input.reason ?? null,
  });
