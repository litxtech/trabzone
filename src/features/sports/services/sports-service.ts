import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  ChatMessage,
  ChatPage,
  ChatReportReason,
  ChatState,
  ChatSummary,
  FanCategory,
  FanMediaPage,
  FeedCard,
  FixtureDetail,
  FixtureLineups,
  FixturePulse,
  FixtureScope,
  FixtureStats,
  FixtureTimeline,
  Fixture,
  Poll,
  SportsCenter,
  SportsHistoryItem,
  SportsPrefs,
  SportsPrefsInput,
  Standings,
  ThreadShare,
} from '../types';

async function call<T>(name: string, params?: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(name, params ?? {});
  if (error) return fail(rpcError(error));
  if (data == null) return fail(appError('not_found'));
  return ok(data as T);
}

// --- Maç verisi (herkese açık) ---------------------------------------------

export function fetchFeedCard(includeTest: boolean) {
  return call<FeedCard>('sports_feed_card', { p_include_test: includeTest });
}

export function fetchCenter() {
  return call<SportsCenter>('sports_center');
}

export function fetchFixtureDetail(id: number) {
  return call<FixtureDetail>('sports_fixture_detail', { p_fixture: id });
}

export function fetchFixtureStats(id: number) {
  return call<FixtureStats>('sports_fixture_stats', { p_fixture: id });
}

export function fetchFixtureTimeline(id: number) {
  return call<FixtureTimeline>('sports_fixture_timeline', { p_fixture: id });
}

export function fetchFixtureLineups(id: number) {
  return call<FixtureLineups>('sports_fixture_lineups', { p_fixture: id });
}

export function fetchStandings(league: number | null, season: number | null) {
  return call<Standings>('sports_standings', { p_league: league, p_season: season });
}

export function fetchFixtures(scope: FixtureScope, limit: number, offset: number, league: number | null = null) {
  return call<Fixture[]>('sports_fixtures_list', { p_scope: scope, p_limit: limit, p_offset: offset, p_league: league });
}

export function fetchPulse(id: number) {
  return call<FixturePulse>('sports_fixture_pulse', { p_fixture: id });
}

// --- Sohbet ----------------------------------------------------------------

export function fetchChatState(id: number) {
  return call<ChatState>('sports_chat_state', { p_fixture: id });
}

export function fetchChat(id: number, options: { before?: number | null; after?: number | null; limit?: number }) {
  return call<ChatPage>('sports_chat_list', {
    p_fixture: id,
    p_before: options.before ?? null,
    p_after: options.after ?? null,
    p_limit: options.limit ?? 50,
  });
}

export function sendChat(id: number, body: string, clientId: string, replyTo: number | null, asModerator = false) {
  return call<ChatMessage>('sports_chat_send', {
    p_fixture: id,
    p_body: body,
    p_reply_to: replyTo,
    p_client_id: clientId,
    p_as_moderator: asModerator,
  });
}

export function deleteChat(messageId: number) {
  return call<{ id: number; status: string }>('sports_chat_delete', { p_message: messageId });
}

export function toggleChatLike(messageId: number) {
  return call<{ liked: boolean; like_count: number }>('sports_chat_toggle_like', { p_message: messageId });
}

export function reportChat(messageId: number, reason: ChatReportReason, note?: string) {
  return call<{ ok: boolean }>('sports_chat_report', { p_message: messageId, p_reason: reason, p_note: note ?? null });
}

export function chatHeartbeat(id: number) {
  return call<ChatSummary>('sports_chat_heartbeat', { p_fixture: id });
}

export function modRemoveChat(messageId: number, reason: string) {
  return call<{ id: number; status: string }>('sports_chat_mod_remove', { p_message: messageId, p_reason: reason });
}

export function modSanction(userId: string, kind: 'mute' | 'kick' | 'ban', minutes: number | null, reason: string, fixtureId: number | null) {
  return call<{ id: string }>('sports_chat_mod_sanction', {
    p_user: userId,
    p_kind: kind,
    p_minutes: minutes,
    p_reason: reason,
    p_fixture: fixtureId,
  });
}

// --- Anket -----------------------------------------------------------------

export function fetchPolls(id: number) {
  return call<Poll[]>('sports_polls_list', { p_fixture: id });
}

export function votePoll(pollId: string, optionId: string) {
  return call<Poll>('sports_poll_vote', { p_poll: pollId, p_option: optionId });
}

// --- Taraftar / haber --------------------------------------------------------

export function fetchFanMedia(id: number, category: FanCategory | null, limit: number, offset: number) {
  return call<FanMediaPage>('sports_media_list', {
    p_fixture: id,
    p_category: category,
    p_limit: limit,
    p_offset: offset,
  });
}

export function attachFanMedia(id: number, postId: string, category: FanCategory) {
  return call<{ id: string }>('sports_media_attach', { p_fixture: id, p_post: postId, p_category: category });
}

export function fetchFixtureNews(id: number, limit = 12) {
  return call<Record<string, unknown>[]>('sports_news_list', { p_fixture: id, p_limit: limit });
}

// --- Bildirim ----------------------------------------------------------------

export function fetchSportsPrefs() {
  return call<SportsPrefs>('sports_prefs_get');
}

export function saveSportsPrefs(input: SportsPrefsInput) {
  return call<SportsPrefs>('sports_prefs_set', { p_payload: input });
}

export function fetchFixtureMute(id: number) {
  return call<{ muted: boolean }>('sports_fixture_mute_get', { p_fixture: id });
}

export function setFixtureMute(id: number, muted: boolean) {
  return call<{ muted: boolean }>('sports_fixture_mute', { p_fixture: id, p_muted: muted });
}

export function fetchSportsHistory(limit: number, offset: number) {
  return call<{ items: SportsHistoryItem[] }>('sports_notification_history', { p_limit: limit, p_offset: offset });
}

// --- Konuşma paylaşımı -------------------------------------------------------

export function fetchThreadShare(contentType: 'post' | 'reel' | 'match', commentId: string, replyLimit = 5) {
  return call<ThreadShare>('comment_thread_share', {
    p_content_type: contentType,
    p_comment_id: commentId,
    p_reply_limit: replyLimit,
  });
}
