import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';

import type { Fixture, MatchEvent, Poll, SportsAuthor } from '../types';

async function call<T>(name: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, params ?? {});
  if (error) throw rpcError(error);
  if (data == null) throw appError('not_found');
  return data as T;
}

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------
export type SportsHealth = 'unknown' | 'unconfigured' | 'healthy' | 'degraded' | 'down' | 'quota' | string;

export type AdminOverview = {
  configured: {
    api_key: boolean;
    team_id: number | null;
    season: number | null;
    team_verified_at: string | null;
    worker_url: boolean;
    sync_enabled: boolean;
  };
  health: SportsHealth;
  last_error: string | null;
  last_error_at: string | null;
  consecutive_failures: number;
  live: Fixture | null;
  next: Fixture | null;
  last_sync: Record<'tick' | 'live' | 'prematch' | 'schedule' | 'standings' | 'leagues' | 'squad' | 'status', string | null>;
  quota: {
    plan: string | null;
    limit_day: number | null;
    remaining_day: number | null;
    checked_at: string | null;
    used_today: number;
    budget: number | null;
    reserve: number | null;
  };
  chat: { messages_10m: number; active_users: number; open_reports: number };
  notifications: { queued: number; push_pending: number; push_sent_24h: number; push_failed_24h: number; subscribers: number };
  recent_errors: { at: string; job: string; endpoint: string | null; error: string | null; http_status: number | null }[];
  counts: { fixtures: number; competitions: number; pending_media: number; test_fixtures: number };
};

export type TeamCandidate = {
  id: number;
  name: string;
  code: string | null;
  country: string | null;
  founded: number | null;
  national: boolean;
  logo: string | null;
  venue: string | null;
  city: string | null;
};

export type AdminCompetition = {
  league_id: number;
  season: number;
  name: string;
  type: string | null;
  country: string | null;
  is_current: boolean;
  is_enabled: boolean;
  priority: number;
  coverage: Record<string, unknown> | null;
  start_date: string | null;
  end_date: string | null;
  last_synced_at: string | null;
};

/** `sports_settings` satırı; anahtar değeri hiçbir zaman dönmez (yalnızca `api_key_present`). */
export type AdminSettings = {
  api_key_present: boolean;
  api_base_url: string;
  team_search: string;
  team_id: number | null;
  team_verified_at: string | null;
  team_candidates: TeamCandidate[];
  season: number | null;
  season_auto: boolean;
  sync_enabled: boolean;
  live_interval_seconds: number;
  stats_interval_seconds: number;
  prematch_interval_seconds: number;
  schedule_interval_minutes: number;
  matchday_schedule_interval_minutes: number;
  standings_interval_minutes: number;
  leagues_interval_hours: number;
  squad_interval_hours: number;
  daily_request_budget: number | null;
  request_reserve: number;
  feed_card_enabled: boolean;
  feed_prematch_minutes: number;
  feed_postmatch_minutes: number;
  feed_default_view: 'compact' | 'expanded';
  feed_show_chat_count: boolean;
  feed_show_stats: boolean;
  feed_allow_hide: boolean;
  feed_show_archive: boolean;
  logos_enabled: boolean;
  player_photos_enabled: boolean;
  rights_note: string | null;
  chat_enabled: boolean;
  chat_max_length: number;
  chat_rate_per_minute: number;
  chat_duplicate_window_seconds: number;
  chat_links_allowed: boolean;
  chat_blocked_terms: string[];
  chat_open_before_minutes: number;
  chat_close_after_minutes: number;
  chat_retention_days: number;
  comments_enabled: boolean;
  auto_polls_enabled: boolean;
  notifications_enabled: boolean;
  reminder_minutes: number;
  competitions: AdminCompetition[];
  team: { id: number; name: string; country: string | null; logo_url: string | null } | null;
  secret_name: string;
};

export type AdminFixture = Fixture & {
  feature_state: 'auto' | 'pinned' | 'suppressed';
  feature_reason: string | null;
  hidden: boolean;
  hidden_reason: string | null;
  sync_failures: number;
  last_sync_error: string | null;
  resync_requested_at: string | null;
  counts?: { events: number; retracted: number; hidden_events: number; stats: number; lineups: number; players: number; chat: number; comments: number };
  chat_slow_mode_seconds?: number;
  chat_pinned?: { body: string; at: string; by: SportsAuthor | null } | null;
};

export type AdminEvent = MatchEvent & {
  status: 'active' | 'retracted' | 'hidden';
  hidden_reason: string | null;
  event_key: string;
  missing_count: number;
  revisions: unknown;
  retracted_at: string | null;
  last_seen_at: string | null;
};

export type AdminFixtureDetail = {
  fixture: AdminFixture;
  events: AdminEvent[];
  phases: { status: string; elapsed: number | null; at: string }[];
  notifications: { id: string; type: string; key: string; title: string; body: string; status: string; recipients: number | null; created_at: string }[];
  audit: { at: string; action: string; reason: string | null; actor: SportsAuthor | null }[];
};

export type AdminChatMessage = {
  id: number;
  kind: string;
  status: string;
  body: string | null;
  raw_body: string | null;
  removed_reason: string | null;
  created_at: string;
  reports: number;
  author: SportsAuthor | null;
};

export type AdminChatReport = {
  id: string;
  reason: string;
  note: string | null;
  status: string;
  created_at: string;
  reporter: SportsAuthor | null;
  message: AdminChatMessage & { user_id: string };
  fixture: { id: number; home: string; away: string };
  total_reports: number;
};

export type AdminSanction = {
  id: string;
  kind: 'mute' | 'kick' | 'ban';
  fixture_id: number | null;
  expires_at: string | null;
  reason: string | null;
  created_at: string;
  revoked_at: string | null;
  user: SportsAuthor | null;
  by: SportsAuthor | null;
};

export type AdminComment = {
  id: string;
  body: string;
  status: string;
  reason: string | null;
  parent_id: string | null;
  like_count: number;
  created_at: string;
  author: SportsAuthor | null;
  fixture: { id: number; home: string; away: string };
  reports: number;
};

export type AdminMedia = {
  id: string;
  category: string;
  status: string;
  hidden_reason: string | null;
  created_at: string;
  post: Record<string, unknown> | null;
  fixture: { id: number; home: string; away: string };
};

export type AdminPoll = Poll & {
  status: string;
  auto_key: string | null;
  created_at: string;
  real_total: number;
  real_options: { id: string; label: string; votes: number }[];
  new_account_votes: number;
  changed_votes: number;
};

export type AdminNotification = {
  id: string;
  fixture_id: number | null;
  type: string;
  key: string;
  title: string;
  body: string;
  status: string;
  recipients: number | null;
  is_test: boolean;
  created_at: string;
  processed_at: string | null;
  last_error: string | null;
  push: { sent: number; delivered: number; pending: number; suppressed: number; failed: number } | null;
};

export type AdminSyncLog = {
  id: number;
  run_id: string | null;
  job: string;
  endpoint: string | null;
  status: string;
  http_status: number | null;
  duration_ms: number | null;
  results: number | null;
  remaining: number | null;
  error: string | null;
  created_at: string;
};

export type AdminAudit = {
  id: string;
  at: string;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  actor: SportsAuthor | null;
};

// ---------------------------------------------------------------------------
// Sorgular
// ---------------------------------------------------------------------------
export const sportsAdminKeys = {
  all: ['sports-admin'] as const,
  overview: ['sports-admin', 'overview'] as const,
  settings: ['sports-admin', 'settings'] as const,
  fixtures: (scope: string, search: string) => ['sports-admin', 'fixtures', scope, search] as const,
  fixture: (id: number) => ['sports-admin', 'fixture', id] as const,
  chat: (id: number, status: string | null) => ['sports-admin', 'chat', id, status] as const,
  reports: (status: string | null) => ['sports-admin', 'reports', status] as const,
  sanctions: ['sports-admin', 'sanctions'] as const,
  moderators: ['sports-admin', 'moderators'] as const,
  comments: (status: string | null) => ['sports-admin', 'comments', status] as const,
  media: (status: string | null) => ['sports-admin', 'media', status] as const,
  polls: (id: number) => ['sports-admin', 'polls', id] as const,
  notifications: (offset: number) => ['sports-admin', 'notifications', offset] as const,
  logs: (status: string | null, offset: number) => ['sports-admin', 'logs', status, offset] as const,
  audit: (offset: number) => ['sports-admin', 'audit', offset] as const,
};

export function useSportsAdminOverview(enabled: boolean) {
  return useQuery({
    queryKey: sportsAdminKeys.overview,
    queryFn: () => call<AdminOverview>('sports_admin_overview'),
    enabled,
    refetchInterval: 20_000,
  });
}

export function useSportsAdminSettings(enabled: boolean) {
  return useQuery({ queryKey: sportsAdminKeys.settings, queryFn: () => call<AdminSettings>('sports_admin_settings_get'), enabled });
}

export function useSportsAdminFixtures(scope: string, search: string, enabled: boolean) {
  return useQuery({
    queryKey: sportsAdminKeys.fixtures(scope, search),
    queryFn: () =>
      call<{ items: AdminFixture[] }>('sports_admin_fixtures', {
        p_scope: scope,
        p_search: search.trim() || null,
        p_limit: 40,
        p_offset: 0,
      }),
    enabled,
    refetchInterval: scope === 'live' || scope === 'test' ? 15_000 : false,
  });
}

export function useSportsAdminFixture(id: number | null) {
  return useQuery({
    queryKey: sportsAdminKeys.fixture(id ?? 0),
    queryFn: () => call<AdminFixtureDetail>('sports_admin_fixture_get', { p_fixture: id }),
    enabled: id != null,
    refetchInterval: 15_000,
  });
}

export function useSportsAdminChat(id: number | null, status: string | null) {
  return useQuery({
    queryKey: sportsAdminKeys.chat(id ?? 0, status),
    queryFn: () => call<{ items: AdminChatMessage[] }>('sports_admin_chat_messages', { p_fixture: id, p_status: status, p_limit: 80 }),
    enabled: id != null,
    refetchInterval: 10_000,
  });
}

export function useSportsAdminReports(status: string | null, enabled: boolean) {
  return useQuery({
    queryKey: sportsAdminKeys.reports(status),
    queryFn: () => call<{ items: AdminChatReport[] }>('sports_admin_chat_reports', { p_status: status, p_limit: 60 }),
    enabled,
    refetchInterval: 20_000,
  });
}

export function useSportsAdminSanctions(enabled: boolean) {
  return useQuery({
    queryKey: sportsAdminKeys.sanctions,
    queryFn: () => call<{ items: AdminSanction[] }>('sports_admin_sanctions', { p_active: true, p_limit: 100 }),
    enabled,
  });
}

export function useSportsAdminModerators(enabled: boolean) {
  return useQuery({
    queryKey: sportsAdminKeys.moderators,
    queryFn: () => call<{ user: SportsAuthor | null; added_by: SportsAuthor | null; created_at: string }[]>('sports_admin_moderators'),
    enabled,
  });
}

export function useSportsAdminComments(status: string | null, enabled: boolean) {
  return useQuery({
    queryKey: sportsAdminKeys.comments(status),
    queryFn: () => call<{ items: AdminComment[] }>('sports_admin_comments', { p_status: status, p_limit: 60 }),
    enabled,
  });
}

export function useSportsAdminMedia(status: string | null, enabled: boolean) {
  return useQuery({
    queryKey: sportsAdminKeys.media(status),
    queryFn: () => call<{ items: AdminMedia[] }>('sports_admin_media', { p_status: status, p_limit: 40 }),
    enabled,
  });
}

export function useSportsAdminPolls(id: number | null) {
  return useQuery({
    queryKey: sportsAdminKeys.polls(id ?? 0),
    queryFn: () => call<AdminPoll[]>('sports_admin_polls', { p_fixture: id }),
    enabled: id != null,
  });
}

export function useSportsAdminNotifications(offset: number, enabled: boolean) {
  return useQuery({
    queryKey: sportsAdminKeys.notifications(offset),
    queryFn: () => call<{ items: AdminNotification[] }>('sports_admin_notifications', { p_limit: 30, p_offset: offset }),
    enabled,
    refetchInterval: 20_000,
  });
}

export function useSportsAdminLogs(status: string | null, offset: number, enabled: boolean) {
  return useQuery({
    queryKey: sportsAdminKeys.logs(status, offset),
    queryFn: () =>
      call<{ items: AdminSyncLog[]; usage: { day: string; endpoint: string; requests: number; failures: number }[] }>(
        'sports_admin_sync_logs',
        { p_status: status, p_limit: 40, p_offset: offset },
      ),
    enabled,
  });
}

export function useSportsAdminAudit(offset: number, enabled: boolean) {
  return useQuery({
    queryKey: sportsAdminKeys.audit(offset),
    queryFn: () => call<{ items: AdminAudit[] }>('sports_admin_audit_list', { p_limit: 40, p_offset: offset }),
    enabled,
  });
}

/** Yazma işlemleri; başarıdan sonra admin ve herkese açık maç sorguları tazelenir. */
export function useSportsAdminMutation<TInput, TResult = unknown>(fn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sportsAdminKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['sports'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Yazma işlemleri (hepsi sunucuda gerekçe + denetim kaydı ister)
// ---------------------------------------------------------------------------
export const sportsAdminApi = {
  updateSettings: (input: { patch: Record<string, unknown>; reason: string }) =>
    call<AdminSettings>('sports_admin_settings_update', { p_patch: input.patch, p_reason: input.reason }),
  setTeam: (input: { teamId: number; reason: string }) =>
    call<AdminSettings>('sports_admin_team_set', { p_team_id: input.teamId, p_reason: input.reason }),
  updateCompetition: (input: { league: number; season: number; enabled?: boolean; priority?: number; reason: string }) =>
    call('sports_admin_competition_update', {
      p_league: input.league,
      p_season: input.season,
      p_enabled: input.enabled ?? null,
      p_priority: input.priority ?? null,
      p_reason: input.reason,
    }),
  fixtureAction: (input: { id: number; action: string; reason: string; payload?: Record<string, unknown> }) =>
    call<AdminFixtureDetail>('sports_admin_fixture_action', {
      p_fixture: input.id,
      p_action: input.action,
      p_reason: input.reason,
      p_payload: input.payload ?? {},
    }),
  eventAction: (input: { id: string; action: 'hide' | 'unhide'; reason: string }) =>
    call<AdminFixtureDetail>('sports_admin_event_action', { p_event: input.id, p_action: input.action, p_reason: input.reason }),
  removeMessage: (input: { id: number; reason: string }) =>
    call('sports_chat_mod_remove', { p_message: input.id, p_reason: input.reason }),
  resolveReport: (input: { id: string; action: 'remove' | 'dismiss'; reason: string }) =>
    call('sports_admin_chat_report_resolve', { p_report: input.id, p_action: input.action, p_reason: input.reason }),
  sanction: (input: { username: string; kind: 'mute' | 'kick' | 'ban'; minutes: number | null; reason: string; fixture?: number | null }) =>
    call('sports_admin_sanction_by_username', {
      p_username: input.username,
      p_kind: input.kind,
      p_minutes: input.minutes,
      p_reason: input.reason,
      p_fixture: input.fixture ?? null,
    }),
  revokeSanction: (input: { id: string; reason: string }) =>
    call('sports_admin_sanction_revoke', { p_id: input.id, p_reason: input.reason }),
  setModerator: (input: { username: string; add: boolean; reason: string }) =>
    call('sports_admin_moderator_set', { p_username: input.username, p_add: input.add, p_reason: input.reason }),
  commentAction: (input: { id: string; action: 'hide' | 'restore' | 'remove'; reason: string }) =>
    call('sports_admin_comment_action', { p_comment: input.id, p_action: input.action, p_reason: input.reason }),
  mediaAction: (input: { id: string; action: 'hide' | 'restore'; reason: string }) =>
    call('sports_admin_media_action', { p_media: input.id, p_action: input.action, p_reason: input.reason }),
  newsLink: (input: { fixture: number; post: string; add: boolean; reason: string }) =>
    call('sports_admin_news_link', { p_fixture: input.fixture, p_post: input.post, p_add: input.add, p_reason: input.reason }),
  createPoll: (input: {
    fixture: number;
    question: string;
    options: string[];
    closesAt: string | null;
    allowChange: boolean;
    visibility: 'after_vote' | 'always' | 'after_close';
    reason: string;
  }) =>
    call<AdminPoll[]>('sports_admin_poll_create', {
      p_fixture: input.fixture,
      p_question: input.question,
      p_options: input.options,
      p_closes_at: input.closesAt,
      p_allow_change: input.allowChange,
      p_visibility: input.visibility,
      p_reason: input.reason,
    }),
  pollAction: (input: { id: string; action: 'close' | 'disable' | 'activate'; reason: string }) =>
    call<AdminPoll[]>('sports_admin_poll_action', { p_poll: input.id, p_action: input.action, p_reason: input.reason }),
  announcement: (input: { fixture: number | null; title: string; body: string; reason: string }) =>
    call<{ id: string }>('sports_admin_announcement', {
      p_fixture: input.fixture,
      p_title: input.title,
      p_body: input.body,
      p_reason: input.reason,
    }),
  testPush: (input: { title?: string | null; body?: string | null }) =>
    call<{ id: string }>('sports_admin_test_push', { p_title: input.title ?? null, p_body: input.body ?? null }),
  cancelNotification: (input: { id: string; reason: string }) =>
    call('sports_admin_notification_cancel', { p_id: input.id, p_reason: input.reason }),
  testFixtureCreate: (input: { opponent: string; kickoffMinutes: number }) =>
    call<AdminFixtureDetail>('sports_admin_test_fixture_create', {
      p_opponent: input.opponent,
      p_kickoff_minutes: input.kickoffMinutes,
    }),
  testFixtureStep: (input: { id: number; step: string }) =>
    call<AdminFixtureDetail>('sports_admin_test_fixture_step', { p_fixture: input.id, p_step: input.step }),
  testFixtureDelete: (input: { id: number }) => call('sports_admin_test_fixture_delete', { p_fixture: input.id }),
};

// ---------------------------------------------------------------------------
// sports-sync edge function (API anahtarı yalnızca sunucuda)
// ---------------------------------------------------------------------------
export type SportsWorkerAction =
  | { action: 'test' }
  | { action: 'run'; jobs: string[]; reason: string }
  | { action: 'resync'; fixture_id: number; reason: string }
  | { action: 'dispatch'; reason: string };

export type SportsWorkerTest = {
  ok: boolean;
  key_missing?: boolean;
  plan?: string | null;
  active?: boolean | null;
  subscription_end?: string | null;
  limit_day?: number | null;
  used_day?: number | null;
  remaining_day?: number | null;
  latency_ms?: number | null;
  error?: string | null;
};

const WORKER_ERRORS: Record<string, string> = {
  unauthorized: 'Bu işlem için yetkin yok.',
  reason_required: 'Gerekçe en az 5 karakter olmalı.',
  rate_limited: 'Çok sık deneme yapıldı. Biraz bekle.',
  jobs_required: 'Çalıştırılacak iş seçilmedi.',
  fixture_id_required: 'Geçerli bir maç kimliği gerekli.',
  worker_failed: 'İşlem sunucuda başarısız oldu.',
};

export async function invokeSportsWorker<T = Record<string, unknown>>(input: SportsWorkerAction): Promise<T> {
  const { data, error } = await supabase.functions.invoke('sports-sync', { body: input });
  if (error) {
    let code = 'worker_failed';
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = (await context.json()) as { error?: string };
        if (payload?.error) code = payload.error;
      } catch {
        // gövde JSON değil
      }
    }
    throw new Error(WORKER_ERRORS[code] ?? `İşlem başarısız (${code}).`);
  }
  return data as T;
}
