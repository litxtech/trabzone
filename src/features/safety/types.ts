/**
 * Destek, bildirme ve cocuk guvenligi alan modeli.
 *
 * Tum alan adlari veritabanindaki RPC ciktilariyla birebir eslesir; servis
 * katmani yalnizca bu tipleri dondurur, ekranlar baska bir donusum yapmaz.
 */

export type AgeGroup = 'unknown' | 'child' | 'adult';
export type VerificationState =
  | 'none'
  | 'self_declared'
  | 'pending_guardian'
  | 'verified'
  | 'rejected';

export type SupportCategoryCode =
  | 'account_access'
  | 'security_privacy'
  | 'technical'
  | 'content'
  | 'messaging_calls'
  | 'payments'
  | 'notifications'
  | 'child_safety'
  | 'other';

export type TicketStatusCode =
  | 'received'
  | 'under_review'
  | 'awaiting_user'
  | 'info_required'
  | 'priority_review'
  | 'resolved'
  | 'closed';

export type TicketPriority = 'normal' | 'high' | 'urgent';

export type ReportStatusCode =
  | 'received'
  | 'under_review'
  | 'action_taken'
  | 'resolved'
  | 'dismissed'
  | 'closed';

export type ReportPriority = 'normal' | 'high' | 'critical';

export type ReportTargetType =
  | 'user'
  | 'profile'
  | 'post'
  | 'reel'
  | 'comment'
  | 'message'
  | 'map_share'
  | 'live'
  | 'call'
  | 'room'
  | 'story'
  | 'listing'
  | 'other';

export type ChildReasonCode =
  | 'child_sexual_exploitation'
  | 'child_grooming'
  | 'child_immediate_danger'
  | 'child_sextortion'
  | 'child_trafficking'
  | 'child_bullying'
  | 'child_privacy'
  | 'child_self_harm'
  | 'child_other';

export type DmPolicy = 'everyone' | 'friends' | 'nobody';
export type CallPolicy = 'everyone' | 'friends' | 'nobody';
export type CommentPolicy = 'everyone' | 'friends' | 'nobody';

export type Attachment = {
  path: string;
  name: string;
  mime: string;
  size: number;
  /** Yalnizca imzali goruntuleme icin doldurulur. */
  url?: string;
};

export type TicketMessage = {
  id: string;
  author_role: 'user' | 'agent' | string;
  body: string;
  attachments: Attachment[] | null;
  created_at: string;
  read_at: string | null;
  is_internal?: boolean;
};

export type TicketSummary = {
  id: string;
  ticket_no: string;
  subject: string;
  category_code: SupportCategoryCode;
  status_code: TicketStatusCode;
  priority: TicketPriority;
  created_at: string;
  last_message_at: string | null;
  sla_due_at: string | null;
  unread: number;
};

export type TicketDetail = Omit<TicketSummary, 'unread'> & {
  closed_at: string | null;
  assigned_to: string | null;
  messages: TicketMessage[];
  is_staff_view: boolean;
  can_reply: boolean;
};

export type ReportSummary = {
  id: string;
  report_no: string;
  target_type: ReportTargetType;
  target_id: string;
  reason_code: string;
  child_reason_code: ChildReasonCode | null;
  is_child_safety: boolean;
  priority: ReportPriority;
  status_code: ReportStatusCode;
  created_at: string;
  reviewed_at: string | null;
  closed_at: string | null;
  sla_due_at: string | null;
  resolution_note: string | null;
};

export type ReportDetail = ReportSummary & {
  description: string | null;
};

export type ReportReceipt = {
  id: string;
  report_no: string;
  target_type: ReportTargetType;
  target_id: string;
  reason_code: string;
  child_reason_code: ChildReasonCode | null;
  is_child_safety: boolean;
  priority: ReportPriority;
  status_code: ReportStatusCode;
  sla_due_at: string;
  created_at: string;
  case_id: string | null;
};

export type TicketReceipt = {
  id: string;
  ticket_no: string;
  status_code: TicketStatusCode;
  priority: TicketPriority;
  category_code: SupportCategoryCode;
  sla_due_at: string;
  created_at: string;
};

export type ChildProtection = {
  is_enabled: boolean;
  profile_visibility: 'public' | 'friends' | 'private';
  dm_policy: DmPolicy;
  call_policy: CallPolicy;
  comment_policy: CommentPolicy;
  location_sharing: boolean;
  discoverable: boolean;
  content_filter: 'standard' | 'strict';
  enforced_by_system: boolean;
  guardian_consent_required: boolean;
};

export type GuardianState = {
  required: boolean;
  status: 'none' | 'pending' | 'verified' | 'revoked' | 'rejected' | 'expired';
  requested_at: string | null;
  verified_at: string | null;
  guardian_email_masked: string | null;
};

export type SafetyState = {
  user_id: string;
  country_code: string;
  min_age: number;
  adult_age: number;
  birth_date_set: boolean;
  birth_date: string | null;
  age_group: AgeGroup;
  is_child_protected: boolean;
  verification_state: VerificationState;
  guardian_required: boolean;
  evaluated_at: string | null;
  protection: ChildProtection;
  guardian: GuardianState;
  notifications_unread: number;
};

export type GuardianConsentRequest = {
  consent_id: string;
  status: 'pending';
  email_masked: string;
  expires_at: string;
  delivery: 'email_pending';
};

export type SafetyFaq = {
  id: string;
  category: SupportCategoryCode | string;
  question: string;
  answer: string;
  sort_order: number;
};

export type SafetyPolicy = {
  slug: string;
  version: number;
  title: string;
  summary: string | null;
  body_md: string;
  effective_at: string | null;
  published_at: string | null;
};

export type SafetyNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type StaffInfo = {
  user_id: string | null;
  is_staff: boolean;
  permissions: string[];
};

export type SupportReplyTemplate = {
  id: string;
  title: string;
  category: string | null;
  body: string;
  is_active: boolean;
  updated_at: string;
  created_by_name: string | null;
};

export type AdminTicket = TicketSummary & {
  overdue: boolean;
  assigned_to: string | null;
  assignee_name: string | null;
  user_name: string | null;
  user_id: string;
};

export type AdminReport = Omit<ReportSummary, 'reviewed_at' | 'closed_at' | 'resolution_note'> & {
  overdue: boolean;
  assigned_to: string | null;
  assignee_name: string | null;
  reporter_ref: string;
};

export type AdminReportDetail = Omit<ReportDetail, 'resolution_note'> & {
  target_owner_id: string | null;
  target_snapshot: Record<string, unknown>;
  metadata_safe: Record<string, unknown>;
  assigned_to: string | null;
  resolution_code: string | null;
  resolution_note_public: string | null;
  reporter_id: string | null;
  actions: {
    id: number;
    action_code: string;
    note_internal: string | null;
    note_public: string | null;
    created_at: string;
    actor_role: string;
  }[];
};

export type ChildSafetyIncident = {
  id: string;
  case_ref: string;
  severity: 'low' | 'high' | 'critical' | string;
  category: ChildReasonCode | string;
  status: 'open' | 'investigating' | 'resolved' | 'closed' | string;
  assigned_admin_id: string | null;
  created_at: string;
  report_id: string | null;
};

export type ChildSafetyQueue = {
  incidents: ChildSafetyIncident[];
  reports: {
    id: string;
    report_no: string;
    child_reason_code: ChildReasonCode | null;
    priority: ReportPriority;
    status_code: ReportStatusCode;
    created_at: string;
    sla_due_at: string | null;
    assigned_to: string | null;
  }[];
  critical_count: number;
};

export type GuardianConsent = {
  id: string;
  user_id: string;
  user_name: string | null;
  guardian_email: string | null;
  guardian_name: string | null;
  relation: string | null;
  status: 'pending' | 'verified' | 'rejected' | 'revoked' | 'expired';
  method: string;
  requested_at: string;
  verified_at: string | null;
  expires_at: string | null;
  age_group: AgeGroup | null;
  age_verification: VerificationState | null;
};

export type AgeOverview = {
  total_assured: number;
  children: number;
  adults: number;
  pending_guardian: number;
  verified_guardian: number;
  awaiting_guardian_verification: number;
  recent: {
    user_id: string;
    user_name: string | null;
    age_group: AgeGroup;
    verification_state: VerificationState;
    created_at: string;
  }[];
  viewer: string;
};

export type AuditLogItem = {
  id: number;
  action_code: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  actor_name: string | null;
};

export type ReportDraft = {
  targetType: ReportTargetType;
  targetId: string;
  targetUserId?: string | null;
  targetLabel?: string;
  snapshot?: Record<string, unknown>;
};
