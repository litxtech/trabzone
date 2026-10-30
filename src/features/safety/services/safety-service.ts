import type { PostgrestError } from '@supabase/supabase-js';

import { appError, type AppError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  AdminReport,
  AdminReportDetail,
  AdminTicket,
  AgeOverview,
  Attachment,
  AuditLogItem,
  ChildSafetyQueue,
  GuardianConsent,
  GuardianConsentRequest,
  ReportDetail,
  ReportDraft,
  ReportReceipt,
  ReportStatusCode,
  ReportSummary,
  SafetyFaq,
  SafetyNotification,
  SafetyPolicy,
  SafetyState,
  StaffInfo,
  SupportCategoryCode,
  SupportReplyTemplate,
  TicketDetail,
  TicketPriority,
  TicketReceipt,
  TicketStatusCode,
  TicketSummary,
} from '../types';

const SAFETY_ERRORS: Record<string, AppError> = {
  not_authenticated: appError('session_missing'),
  insufficient_privilege: appError('forbidden'),
  not_child_protected: appError('forbidden', 'Bu işlem yalnızca çocuk korumalı hesaplar için geçerli.'),
  birth_date_locked: appError(
    'forbidden',
    'Doğum tarihi kilitli. Değişiklik için destek ekibine başvur.',
  ),
  age_below_minimum: appError(
    'invalid_input',
    '13 yaşından küçük kullanıcılar Trabzone hesabı oluşturamaz. Girdiğin doğum tarihini kontrol et.',
  ),
  invalid_birth_date: appError('invalid_input', 'Geçerli bir doğum tarihi gir.'),
  duplicate_report: appError(
    'duplicate',
    'Bu içerik için 24 saat içinde açık bir bildirimin var. Başvurularım bölümünden takip edebilirsin.',
  ),
  invalid_reason: appError('invalid_input', 'Geçerli bir bildirim nedeni seç.'),
  invalid_child_reason: appError('invalid_input', 'Çocuk güvenliği için geçerli bir alt neden seç.'),
  missing_child_reason: appError('invalid_input', 'Çocuk güvenliği alt nedenini seçmen gerekiyor.'),
  invalid_target_type: appError('invalid_input', 'Bildirilecek içerik türü geçersiz.'),
  missing_target: appError('invalid_input', 'Bildirilecek içerik bulunamadı.'),
  invalid_attachments: appError('invalid_input', 'En fazla 3 ek dosya yükleyebilirsin.'),
  invalid_snapshot: appError('invalid_input', 'İçerik özeti çok büyük.'),
  invalid_category: appError('invalid_input', 'Geçerli bir konu seç.'),
  invalid_subject: appError('invalid_input', 'Konu en az 3 karakter olmalı.'),
  invalid_body: appError('invalid_input', 'Mesajın en az 10 karakter olmalı.'),
  invalid_guardian_email: appError('invalid_input', 'Velinin e-posta adresi geçerli değil.'),
  consent_already_verified: appError('duplicate', 'Bu hesap için veli onayı zaten tamamlanmış.'),
  guardian_not_required: appError('invalid_input', 'Bu hesap için veli onayı gerekmiyor.'),
  consent_not_pending: appError('invalid_input', 'Bu onay talebi artık beklemede değil.'),
  invalid_token: appError('invalid_input', 'Onay bağlantısı geçersiz.'),
  token_expired: appError('invalid_input', 'Onay bağlantısının süresi doldu. Yeni talep oluştur.'),
  consent_not_found: appError('not_found'),
  ticket_not_found: appError('not_found'),
  report_not_found: appError('not_found'),
  case_not_found: appError('not_found'),
  ticket_closed: appError('ticket_closed'),
  rate_limited: appError('rate_limited'),
  invalid_dm_policy: appError('invalid_input', 'Mesaj ayarı geçersiz.'),
  invalid_call_policy: appError('invalid_input', 'Arama ayarı geçersiz.'),
  invalid_comment_policy: appError('invalid_input', 'Yorum ayarı geçersiz.'),
  invalid_status: appError('invalid_input'),
  invalid_action: appError('invalid_input'),
  invalid_priority: appError('invalid_input'),
};

export function mapSafetyError(error: PostgrestError | Error | null | undefined): AppError {
  if (!error) {
    return appError('unknown');
  }
  const raw = 'message' in error ? error.message : '';
  const code = 'code' in error ? String(error.code ?? '') : '';

  const known = SAFETY_ERRORS[raw.trim()];
  if (known) {
    return known;
  }
  if (code === '42501' || code === 'PGRST301') {
    return appError('forbidden');
  }
  if (code === '42900' || code === 'PGRST116') {
    return appError('rate_limited');
  }
  if (code === 'PGRST202' || code === '42883') {
    return appError('unknown', 'Sunucu güncel değil. Lütfen daha sonra tekrar dene.');
  }
  if (error.message.includes('Failed to fetch') || error.message.includes('Network request failed')) {
    return appError('network');
  }
  return appError('unknown');
}

async function callRpc<T>(
  fn: string,
  args: Record<string, unknown> = {},
): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return fail(mapSafetyError(error));
  }
  return ok(data as unknown as T);
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// -----------------------------------------------------------------------------
// Yas ve cocuk korumasi
// -----------------------------------------------------------------------------

export const fetchSafetyState = () => callRpc<SafetyState>('safety_my_state');

export const setBirthDate = (birthDate: string) =>
  callRpc<SafetyState>('safety_set_birth_date', { p_birth_date: birthDate });

export type ChildSettingsPatch = {
  dmPolicy?: 'friends' | 'nobody';
  callPolicy?: 'friends' | 'nobody';
  commentPolicy?: 'friends' | 'nobody';
  locationSharing?: boolean;
};

export const updateChildSettings = (input: ChildSettingsPatch) =>
  callRpc<{ protection: SafetyState['protection'] }>('safety_update_child_settings', {
    p_dm_policy: input.dmPolicy ?? null,
    p_call_policy: input.callPolicy ?? null,
    p_comment_policy: input.commentPolicy ?? null,
    p_location_sharing: input.locationSharing ?? null,
  });

export type ProfileSafetyFlags = {
  user_id?: string;
  is_child_protected?: boolean;
  restricted_account?: boolean;
  account_label?: string | null;
  restricted_label?: string | null;
  relation?: 'self' | 'friend' | 'admin' | string;
  badge_visible?: boolean;
};

export const fetchProfileFlags = (userId: string) =>
  callRpc<ProfileSafetyFlags>('safety_profile_flags', { p_user_id: userId });

export const requestGuardianConsent = (input: {
  email: string;
  name?: string;
  relation?: string;
}) =>
  callRpc<GuardianConsentRequest>('safety_request_guardian_consent', {
    p_guardian_email: input.email,
    p_guardian_name: input.name ?? null,
    p_relation: input.relation ?? null,
  });

export const revokeGuardianConsent = () => callRpc<{ status: string }>('safety_revoke_guardian_consent');

// -----------------------------------------------------------------------------
// Destek merkezi
// -----------------------------------------------------------------------------

export const fetchFaqs = () => callRpc<SafetyFaq[]>('safety_list_faqs');

export const fetchPolicy = (slug: string) => callRpc<SafetyPolicy | null>('safety_get_policy', { p_slug: slug });

export const createTicket = (input: {
  category: SupportCategoryCode;
  subject: string;
  body: string;
  attachments?: Attachment[];
  referenceType?: string;
  referenceId?: string;
}) =>
  callRpc<TicketReceipt>('safety_create_support_ticket', {
    p_category: input.category,
    p_subject: input.subject,
    p_body: input.body,
    p_attachments: input.attachments ?? [],
    p_reference_type: input.referenceType ?? null,
    p_reference_id: input.referenceId ?? null,
  });

export const fetchMyTickets = async (): Promise<Result<TicketSummary[]>> => {
  const result = await callRpc<{ items: TicketSummary[] }>('safety_list_my_tickets');
  return result.ok ? ok(result.data.items ?? []) : result;
};

export const fetchTicket = (ticketId: string) =>
  callRpc<TicketDetail>('safety_get_ticket', { p_ticket_id: ticketId });

export const sendTicketMessage = (ticketId: string, body: string, attachments?: Attachment[]) =>
  callRpc<{ id: string; status_code: TicketStatusCode }>('safety_send_support_message', {
    p_ticket_id: ticketId,
    p_body: body,
    p_attachments: attachments ?? [],
  });

export const setTicketStatus = (ticketId: string, action: 'close' | 'reopen') =>
  callRpc<{ id: string; status_code: TicketStatusCode }>('safety_set_ticket_status', {
    p_ticket_id: ticketId,
    p_action: action,
  });

// -----------------------------------------------------------------------------
// Bildirimler
// -----------------------------------------------------------------------------

export const createReport = (draft: ReportDraft & {
  reasonCode: string;
  childReasonCode?: string | null;
  description?: string;
  attachments?: Attachment[];
}) =>
  callRpc<ReportReceipt>('safety_create_report', {
    p_target_type: draft.targetType,
    p_target_id: draft.targetId,
    p_reason_code: draft.reasonCode,
    p_child_reason_code: draft.childReasonCode ?? null,
    p_description: draft.description ?? null,
    p_target_user_id: draft.targetUserId ?? null,
    p_attachments: draft.attachments ?? [],
    p_target_snapshot: draft.snapshot ?? {},
  });

export const fetchMyReports = async (): Promise<Result<ReportSummary[]>> => {
  const result = await callRpc<{ items: ReportSummary[] }>('safety_list_my_reports');
  return result.ok ? ok(result.data.items ?? []) : result;
};

export const fetchMyReport = (reportId: string) =>
  callRpc<ReportDetail>('safety_get_my_report', { p_report_id: reportId });

export const fetchNotifications = async (): Promise<Result<SafetyNotification[]>> => {
  const result = await callRpc<{ items: SafetyNotification[] }>('safety_list_my_notifications');
  return result.ok ? ok(result.data.items ?? []) : result;
};

export const markNotificationsRead = () =>
  callRpc<null>('safety_mark_notifications_read');

// -----------------------------------------------------------------------------
// Personel
// -----------------------------------------------------------------------------

export const fetchStaffInfo = () => callRpc<StaffInfo>('safety_staff_me');

export const fetchAdminTickets = (input: {
  status?: string | null;
  category?: string | null;
  search?: string | null;
  assigned?: 'all' | 'me' | 'unassigned';
  limit?: number;
  offset?: number;
}) =>
  callRpc<{ items: AdminTicket[]; total: number; limit: number; offset: number }>(
    'safety_admin_list_tickets',
    {
      p_status: input.status ?? null,
      p_category: input.category ?? null,
      p_search: input.search ?? null,
      p_assigned: input.assigned ?? 'all',
      p_limit: input.limit ?? 30,
      p_offset: input.offset ?? 0,
    },
  );

export const adminUpdateTicket = (input: {
  ticketId: string;
  status?: TicketStatusCode | null;
  priority?: TicketPriority | null;
  assignTo?: string | null;
  assignSelf?: boolean;
}) =>
  callRpc<{ id: string; status_code: TicketStatusCode }>('safety_admin_update_ticket', {
    p_ticket_id: input.ticketId,
    p_status: input.status ?? null,
    p_priority: input.priority ?? null,
    p_assign_to: input.assignTo ?? null,
    p_assign_self: input.assignSelf ?? false,
  });

export const adminReplyTicket = (input: {
  ticketId: string;
  body: string;
  isInternal?: boolean;
  attachments?: Attachment[];
  nextStatus?: TicketStatusCode | null;
}) =>
  callRpc<{ id: string; status_code: TicketStatusCode }>('safety_admin_reply_ticket', {
    p_ticket_id: input.ticketId,
    p_body: input.body,
    p_is_internal: input.isInternal ?? false,
    p_attachments: input.attachments ?? [],
    p_next_status: input.nextStatus ?? null,
  });

export const fetchAdminReports = (input: {
  queue?: 'all' | 'new' | 'critical' | 'unassigned' | 'resolved' | 'child';
  targetType?: string | null;
  limit?: number;
  offset?: number;
}) =>
  callRpc<{ items: AdminReport[]; total: number; limit: number; offset: number }>(
    'safety_admin_list_reports',
    {
      p_queue: input.queue ?? 'all',
      p_target_type: input.targetType ?? null,
      p_limit: input.limit ?? 30,
      p_offset: input.offset ?? 0,
    },
  );

export const fetchAdminReport = (reportId: string) =>
  callRpc<AdminReportDetail>('safety_admin_get_report', { p_report_id: reportId });

export const adminReportAction = (input: {
  reportId: string;
  action: 'start_review' | 'apply_action' | 'dismiss' | 'resolve' | 'close' | 'reopen';
  noteInternal?: string;
  notePublic?: string;
  contentAction?: string;
}) =>
  callRpc<{ id: string; status_code: ReportStatusCode }>('safety_admin_report_action', {
    p_report_id: input.reportId,
    p_action: input.action,
    p_note_internal: input.noteInternal ?? null,
    p_note_public: input.notePublic ?? null,
    p_content_action: input.contentAction ?? null,
  });

export const adminAssignReport = (reportId: string, assignSelf = true) =>
  callRpc<{ id: string; assigned_to: string | null }>('safety_admin_assign_report', {
    p_report_id: reportId,
    p_assign_self: assignSelf,
  });

export const fetchChildQueue = () => callRpc<ChildSafetyQueue>('safety_admin_child_queue');

export const adminAssignChildCase = (caseId: string, assignSelf = true) =>
  callRpc<{ id: string; status: string }>('safety_admin_assign_child_case', {
    p_case_id: caseId,
    p_assign_self: assignSelf,
  });

export const adminResolveChildCase = (caseId: string, status: 'investigating' | 'resolved' | 'closed', note?: string) =>
  callRpc<{ id: string; status: string }>('safety_admin_resolve_child_case', {
    p_case_id: caseId,
    p_status: status,
    p_note_internal: note ?? null,
  });

export const fetchAgeOverview = () => callRpc<AgeOverview>('safety_admin_age_overview');

export const fetchConsents = (status: 'pending' | 'verified' | 'rejected' | 'revoked' | 'expired' | 'all') =>
  callRpc<{ items: GuardianConsent[] }>('safety_admin_list_consents', { p_status: status });

export const adminDecideConsent = (
  consentId: string,
  status: 'verified' | 'rejected' | 'revoked' | 'expired',
  note?: string,
) =>
  callRpc<{ id: string; status: string }>('safety_admin_decide_consent', {
    p_consent_id: consentId,
    p_status: status,
    p_note: note ?? null,
  });

export const adminOverrideAge = (userId: string, birthDate: string, note?: string) =>
  callRpc<SafetyState>('safety_admin_override_age', {
    p_user_id: userId,
    p_birth_date: birthDate,
    p_note: note ?? null,
  });

export const fetchSupportTemplates = () =>
  callRpc<{ items: SupportReplyTemplate[] }>('admin_support_templates_list');

export const adminSaveSupportTemplate = (input: {
  id?: string | null;
  title: string;
  category?: string | null;
  body: string;
  isActive?: boolean;
  reason?: string | null;
}) =>
  callRpc<SupportReplyTemplate>('admin_support_template_save', {
    p_id: input.id ?? null,
    p_title: input.title,
    p_category: input.category ?? null,
    p_body: input.body,
    p_is_active: input.isActive ?? true,
    p_reason: input.reason ?? null,
  });

export const fetchAuditLogs = (entityType?: string | null, limit = 50) =>
  callRpc<{ items: AuditLogItem[] }>('safety_admin_audit_logs', {
    p_entity_type: entityType ?? null,
    p_limit: limit,
  });

export const adminUpsertFaq = (input: {
  id?: string | null;
  category: string;
  question: string;
  answer: string;
  sortOrder?: number;
  isPublished?: boolean;
}) =>
  callRpc<{ id: string }>('safety_admin_upsert_faq', {
    p_id: input.id ?? null,
    p_category: input.category,
    p_question: input.question,
    p_answer: input.answer,
    p_sort_order: input.sortOrder ?? 100,
    p_is_published: input.isPublished ?? true,
  });

// -----------------------------------------------------------------------------
// Ek dosya yukleme
// -----------------------------------------------------------------------------

const SAFE_NAME = /[^a-zA-Z0-9._-]/g;

export const SAFETY_BUCKET = {
  support: 'safety-support',
  report: 'safety-reports',
} as const;

export type SafetyBucket = (typeof SAFETY_BUCKET)[keyof typeof SAFETY_BUCKET];

/**
 * Dosyayi gizli kovaya yukler ve RPC'lere verilecek referansi dondurur.
 * Sunucu tarafi en fazla 3 ek ve 5 MB sinirini uygular; burada da hizli geri
 * bildirim icin kontrol edilir.
 */
export async function uploadSafetyAttachment(input: {
  bucket: SafetyBucket;
  uri: string;
  name: string;
  mime: string;
  size?: number;
}): Promise<Result<Attachment>> {
  const userId = await currentUserId();
  if (!userId) {
    return fail(appError('session_missing'));
  }
  if (input.size && input.size > 5 * 1024 * 1024) {
    return fail(appError('invalid_input', 'Dosya boyutu 5 MB sınırını aşıyor.'));
  }

  try {
    const response = await fetch(input.uri);
    const blob = await response.arrayBuffer();
    const extension = (input.name.split('.').pop() ?? 'bin').toLowerCase();
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${input.name
      .replace(SAFE_NAME, '_')
      .slice(0, 60) || `ek.${extension}`}`;

    const { error } = await supabase.storage.from(input.bucket).upload(path, blob, {
      contentType: input.mime,
      upsert: false,
    });

    if (error) {
      return fail(
        appError(
          'unknown',
          error.message.includes('Bucket not found')
            ? 'Dosya deposu hazır değil. Lütfen daha sonra tekrar dene.'
            : 'Dosya yüklenemedi. Tekrar dene.',
        ),
      );
    }

    return ok({
      path,
      name: input.name.slice(0, 120),
      mime: input.mime,
      size: input.size ?? blob.byteLength,
    });
  } catch {
    return fail(appError('network', 'Dosya okunamadı. Tekrar dene.'));
  }
}

export async function getAttachmentUrl(bucket: SafetyBucket, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  if (error) {
    return null;
  }
  return data.signedUrl;
}
