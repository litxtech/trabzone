import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '@/stores/auth-store';
import type { Result } from '@/utils/result';

import { subscribeChat, subscribeSportsLive, type SportsLiveSignal } from '../realtime';
import * as api from '../services/sports-service';
import type {
  ChatMessage,
  ChatState,
  FanCategory,
  FeedCard,
  FixtureDetail,
  FixtureScope,
  Poll,
  SportsPrefs,
  SportsPrefsInput,
} from '../types';

function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  return promise.then((result) => {
    if (!result.ok) throw result.error;
    return result.data;
  });
}

export const sportsKeys = {
  all: ['sports'] as const,
  feedCard: (includeTest: boolean) => ['sports', 'feed-card', includeTest] as const,
  center: ['sports', 'center'] as const,
  detail: (id: number) => ['sports', 'fixture', id, 'detail'] as const,
  stats: (id: number) => ['sports', 'fixture', id, 'stats'] as const,
  timeline: (id: number) => ['sports', 'fixture', id, 'timeline'] as const,
  lineups: (id: number) => ['sports', 'fixture', id, 'lineups'] as const,
  pulse: (id: number) => ['sports', 'fixture', id, 'pulse'] as const,
  polls: (id: number) => ['sports', 'fixture', id, 'polls'] as const,
  media: (id: number, category: FanCategory | null) => ['sports', 'fixture', id, 'media', category] as const,
  news: (id: number) => ['sports', 'fixture', id, 'news'] as const,
  chatState: (id: number) => ['sports', 'fixture', id, 'chat-state'] as const,
  mute: (id: number) => ['sports', 'fixture', id, 'mute'] as const,
  standings: (league: number | null, season: number | null) => ['sports', 'standings', league, season] as const,
  fixtures: (scope: FixtureScope, league: number | null) => ['sports', 'fixtures', scope, league] as const,
  prefs: ['sports', 'prefs'] as const,
  history: ['sports', 'history'] as const,
};

/** Canlı maçta sunucu 15–30 sn'de bir senkronlar; istemci bundan sık sormaz. */
const LIVE_MS = 20_000;
const IDLE_MS = 60_000;

const notFoundNoRetry = (count: number, error: unknown) => {
  const code = (error as { code?: string } | null)?.code;
  return code !== 'not_found' && code !== 'forbidden' && count < 2;
};

// ---------------------------------------------------------------------------
// Realtime: `sports-live` sinyalleri ilgili sorguları toplu tazeler.
// ---------------------------------------------------------------------------
export function useSportsLiveInvalidation(enabled = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const pending = new Map<string, SportsLiveSignal>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const signals = [...pending.values()];
      pending.clear();
      for (const signal of signals) {
        const id = signal.fixture_id;
        if (signal.kind === 'fixture') {
          void queryClient.invalidateQueries({ queryKey: ['sports', 'feed-card'] });
          void queryClient.invalidateQueries({ queryKey: sportsKeys.center });
          void queryClient.invalidateQueries({ queryKey: ['sports', 'fixtures'] });
          if (id != null) {
            for (const part of ['detail', 'stats', 'timeline', 'lineups', 'pulse', 'chat-state']) {
              void queryClient.invalidateQueries({ queryKey: ['sports', 'fixture', id, part] });
            }
          }
        } else if (signal.kind === 'polls' && id != null) {
          void queryClient.invalidateQueries({ queryKey: sportsKeys.polls(id) });
        } else if (signal.kind === 'media' && id != null) {
          void queryClient.invalidateQueries({ queryKey: ['sports', 'fixture', id, 'media'] });
        } else if (signal.kind === 'settings') {
          void queryClient.invalidateQueries({ queryKey: ['sports', 'feed-card'] });
        } else if (signal.kind === 'standings') {
          void queryClient.invalidateQueries({ queryKey: ['sports', 'standings'] });
          void queryClient.invalidateQueries({ queryKey: sportsKeys.center });
        }
      }
    };
    const unsubscribe = subscribeSportsLive((signal) => {
      if (signal.kind === 'comments') return;
      pending.set(`${signal.kind}:${signal.fixture_id ?? ''}`, signal);
      if (!timer) timer = setTimeout(flush, 900);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, queryClient]);
}

// ---------------------------------------------------------------------------
// Maç verisi
// ---------------------------------------------------------------------------
export function useFeedCard(includeTest: boolean) {
  return useQuery<FeedCard>({
    queryKey: sportsKeys.feedCard(includeTest),
    queryFn: () => unwrap(api.fetchFeedCard(includeTest)),
    staleTime: 15_000,
    refetchInterval: (query) => (query.state.data?.mode === 'live' ? LIVE_MS : IDLE_MS),
    placeholderData: (previous) => previous,
  });
}

export function useSportsCenter() {
  return useQuery({
    queryKey: sportsKeys.center,
    queryFn: () => unwrap(api.fetchCenter()),
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.live ? LIVE_MS : IDLE_MS * 5),
  });
}

export function useFixtureDetail(id: number) {
  return useQuery<FixtureDetail>({
    queryKey: sportsKeys.detail(id),
    queryFn: () => unwrap(api.fetchFixtureDetail(id)),
    enabled: Number.isFinite(id) && id !== 0,
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.data?.fixture.status.is_live ? LIVE_MS : IDLE_MS),
    retry: notFoundNoRetry,
    placeholderData: (previous) => previous,
  });
}

export function useFixtureStats(id: number, live: boolean, enabled = true) {
  return useQuery({
    queryKey: sportsKeys.stats(id),
    queryFn: () => unwrap(api.fetchFixtureStats(id)),
    enabled,
    staleTime: 20_000,
    refetchInterval: live ? 60_000 : false,
    placeholderData: (previous) => previous,
  });
}

export function useFixtureTimeline(id: number, live: boolean, enabled = true) {
  return useQuery({
    queryKey: sportsKeys.timeline(id),
    queryFn: () => unwrap(api.fetchFixtureTimeline(id)),
    enabled,
    staleTime: 10_000,
    refetchInterval: live ? LIVE_MS : false,
    placeholderData: (previous) => previous,
  });
}

export function useFixtureLineups(id: number, enabled = true) {
  return useQuery({
    queryKey: sportsKeys.lineups(id),
    queryFn: () => unwrap(api.fetchFixtureLineups(id)),
    enabled,
    staleTime: 60_000,
  });
}

export function useFixturePulse(id: number, live: boolean, enabled = true) {
  return useQuery({
    queryKey: sportsKeys.pulse(id),
    queryFn: () => unwrap(api.fetchPulse(id)),
    enabled,
    staleTime: 30_000,
    refetchInterval: live ? 60_000 : false,
  });
}

export function useStandings(league: number | null, season: number | null, enabled = true) {
  return useQuery({
    queryKey: sportsKeys.standings(league, season),
    queryFn: () => unwrap(api.fetchStandings(league, season)),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useFixtureList(scope: FixtureScope, league: number | null = null, pageSize = 20) {
  return useInfiniteQuery({
    queryKey: sportsKeys.fixtures(scope, league),
    queryFn: ({ pageParam }) => unwrap(api.fetchFixtures(scope, pageSize, Number(pageParam) || 0, league)),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === pageSize ? pages.length * pageSize : undefined),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Anket
// ---------------------------------------------------------------------------
export function usePolls(id: number, enabled: boolean) {
  return useQuery<Poll[]>({
    queryKey: sportsKeys.polls(id),
    queryFn: () => unwrap(api.fetchPolls(id)),
    enabled,
    staleTime: 15_000,
  });
}

export function useVotePoll(id: number) {
  const queryClient = useQueryClient();
  return useMutation<Poll, Error, { pollId: string; optionId: string }>({
    mutationFn: ({ pollId, optionId }) => unwrap(api.votePoll(pollId, optionId)),
    onSuccess: (poll) => {
      queryClient.setQueryData<Poll[]>(sportsKeys.polls(id), (list) =>
        list?.map((item) => (item.id === poll.id ? poll : item)),
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Taraftar / haber
// ---------------------------------------------------------------------------
export function useFanMedia(id: number, category: FanCategory | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: sportsKeys.media(id, category),
    queryFn: ({ pageParam }) => unwrap(api.fetchFanMedia(id, category, 12, Number(pageParam) || 0)),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.has_more ? pages.length * 12 : undefined),
    enabled,
    staleTime: 30_000,
  });
}

export function useFixtureNews(id: number, enabled: boolean) {
  return useQuery({
    queryKey: sportsKeys.news(id),
    queryFn: () => unwrap(api.fetchFixtureNews(id, 20)),
    enabled,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Bildirim tercihleri
// ---------------------------------------------------------------------------
export function useSportsPrefs(enabled: boolean) {
  return useQuery<SportsPrefs>({
    queryKey: sportsKeys.prefs,
    queryFn: () => unwrap(api.fetchSportsPrefs()),
    enabled,
    staleTime: 30_000,
  });
}

export function useSaveSportsPrefs() {
  const queryClient = useQueryClient();
  return useMutation<SportsPrefs, Error, SportsPrefsInput>({
    mutationFn: (input) => unwrap(api.saveSportsPrefs(input)),
    onSuccess: (data) => queryClient.setQueryData(sportsKeys.prefs, data),
  });
}

export function useFixtureMute(id: number, enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: sportsKeys.mute(id),
    queryFn: () => unwrap(api.fetchFixtureMute(id)),
    enabled,
    staleTime: 60_000,
  });
  const mutation = useMutation<{ muted: boolean }, Error, boolean>({
    mutationFn: (muted) => unwrap(api.setFixtureMute(id, muted)),
    onSuccess: (data) => queryClient.setQueryData(sportsKeys.mute(id), data),
  });
  return { query, mutation };
}

export function useSportsHistory(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: sportsKeys.history,
    queryFn: ({ pageParam }) => unwrap(api.fetchSportsHistory(30, Number(pageParam) || 0)),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.items.length === 30 ? pages.length * 30 : undefined),
    enabled,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Canlı sohbet
// ---------------------------------------------------------------------------
export function useChatState(id: number, enabled: boolean) {
  return useQuery<ChatState>({
    queryKey: sportsKeys.chatState(id),
    queryFn: () => unwrap(api.fetchChatState(id)),
    enabled,
    staleTime: 15_000,
    refetchInterval: enabled ? 30_000 : false,
  });
}

function newClientId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map<number, ChatMessage>();
  for (const message of current) if (!message.pending) byId.set(message.id, message);
  for (const message of incoming) {
    const previous = byId.get(message.id);
    byId.set(message.id, previous ? { ...previous, ...message, liked: message.liked ?? previous.liked } : message);
  }
  // Kendi mesajımızın realtime yankısı client_id taşımaz; yazar + metin eşleşmesiyle iyimser kopya düşer.
  const pending = current.filter(
    (message) =>
      message.pending &&
      !incoming.some(
        (item) =>
          (item.client_id && item.client_id === message.client_id) || (item.is_mine && item.body === message.body),
      ),
  );
  return [...[...byId.values()].sort((a, b) => a.id - b.id), ...pending];
}

const MAX_IN_MEMORY = 600;

/**
 * Maç sohbeti: ilk sayfa RPC'den, yeni mesajlar private realtime kanalından
 * gelir. Kanal koparsa 5 sn'lik aralıklı sorguya geçilir; yeniden bağlanınca
 * son kimlikten sonrası çekilerek boşluk kapatılır. Mesajlar kimliğe göre
 * tekilleştirilir; iyimser mesaj sunucu yanıtı (client_id) ile değiştirilir.
 */
export function useMatchChat(fixtureId: number, enabled: boolean) {
  const session = useSession();
  const userId = session?.user?.id ?? null;
  const active = enabled && Boolean(userId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [initial, setInitial] = useState<{ fixtureId: number; error: string | null } | null>(null);
  const loading = active && initial?.fixtureId !== fixtureId;
  const error = initial?.fixtureId === fixtureId ? initial.error : null;
  const [hasMore, setHasMore] = useState(false);
  const [connected, setConnected] = useState(false);
  const [activeUsers, setActiveUsers] = useState<number | null>(null);
  const lastIdRef = useRef<number | null>(null);
  const loadingOlder = useRef(false);

  useEffect(() => {
    const confirmed = messages.filter((message) => !message.pending);
    lastIdRef.current = confirmed.at(-1)?.id ?? null;
  }, [messages]);

  const fetchNewer = useCallback(async () => {
    const after = lastIdRef.current;
    const result = await api.fetchChat(fixtureId, after ? { after, limit: 100 } : { limit: 50 });
    if (result.ok) {
      setMessages((current) => mergeMessages(current, result.data.items).slice(-MAX_IN_MEMORY));
      if (!after) setHasMore(result.data.has_more);
    }
  }, [fixtureId]);

  // İlk yükleme
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void api.fetchChat(fixtureId, { limit: 50 }).then((result) => {
      if (cancelled) return;
      setInitial({ fixtureId, error: result.ok ? null : result.error.message });
      if (!result.ok) return;
      setMessages(result.data.items);
      setHasMore(result.data.has_more);
    });
    return () => {
      cancelled = true;
    };
  }, [active, fixtureId]);

  // Realtime
  useEffect(() => {
    if (!active) return;
    let wasConnected = false;
    const unsubscribe = subscribeChat(
      fixtureId,
      (event) => {
        if (event.event === 'message') {
          const message = event.payload as unknown as ChatMessage;
          if (!message?.id) return;
          setMessages((current) =>
            mergeMessages(current, [{ ...message, is_mine: message.author?.id === userId, liked: false }]).slice(
              -MAX_IN_MEMORY,
            ),
          );
        } else if (event.event === 'remove') {
          setMessages((current) =>
            current.map((message) =>
              message.id === event.payload.id
                ? { ...message, status: event.payload.status as ChatMessage['status'], body: null }
                : message,
            ),
          );
        } else if (event.event === 'like') {
          setMessages((current) =>
            current.map((message) =>
              message.id === event.payload.id ? { ...message, like_count: event.payload.like_count } : message,
            ),
          );
        }
      },
      (isConnected) => {
        setConnected(isConnected);
        if (isConnected && !wasConnected && lastIdRef.current) void fetchNewer();
        wasConnected = isConnected;
      },
    );
    return unsubscribe;
  }, [active, fetchNewer, fixtureId, userId]);

  // Kanal yokken aralıklı sorgu
  useEffect(() => {
    if (!active || connected) return;
    const timer = setInterval(() => void fetchNewer(), 5_000);
    return () => clearInterval(timer);
  }, [active, connected, fetchNewer]);

  // Aktif kullanıcı sayısı için kalp atışı
  useEffect(() => {
    if (!active) return;
    const beat = () =>
      void api.chatHeartbeat(fixtureId).then((result) => {
        if (result.ok) setActiveUsers(result.data.active_users);
      });
    beat();
    const timer = setInterval(beat, 45_000);
    return () => clearInterval(timer);
  }, [active, fixtureId]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder.current || !hasMore) return;
    const first = messages.find((message) => !message.pending);
    if (!first) return;
    loadingOlder.current = true;
    const result = await api.fetchChat(fixtureId, { before: first.id, limit: 50 });
    loadingOlder.current = false;
    if (result.ok) {
      setMessages((current) => mergeMessages(current, result.data.items));
      setHasMore(result.data.has_more);
    }
  }, [fixtureId, hasMore, messages]);

  const send = useCallback(
    async (body: string, replyTo: ChatMessage | null, asModerator = false): Promise<string | null> => {
      const clientId = newClientId();
      const optimistic: ChatMessage = {
        id: Number.MAX_SAFE_INTEGER - Date.now(),
        fixture_id: fixtureId,
        kind: asModerator ? 'moderator' : 'user',
        status: 'visible',
        body,
        created_at: new Date().toISOString(),
        like_count: 0,
        liked: false,
        is_mine: true,
        author: null,
        reply_to: replyTo
          ? {
              id: replyTo.id,
              author_username: replyTo.author?.username ?? null,
              author_name: replyTo.author?.display_name ?? replyTo.author?.username ?? null,
              body: replyTo.body?.slice(0, 120) ?? null,
            }
          : null,
        pending: true,
        client_id: clientId,
      };
      setMessages((current) => [...current, optimistic]);
      const result = await api.sendChat(fixtureId, body, clientId, replyTo?.id ?? null, asModerator);
      if (!result.ok) {
        setMessages((current) => current.filter((message) => message.client_id !== clientId));
        return result.error.message;
      }
      setMessages((current) =>
        mergeMessages(
          current.filter((message) => message.client_id !== clientId),
          [{ ...result.data, is_mine: true, client_id: clientId }],
        ),
      );
      return null;
    },
    [fixtureId],
  );

  const toggleLike = useCallback(async (message: ChatMessage) => {
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id
          ? { ...item, liked: !item.liked, like_count: Math.max(0, item.like_count + (item.liked ? -1 : 1)) }
          : item,
      ),
    );
    const result = await api.toggleChatLike(message.id);
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id
          ? result.ok
            ? { ...item, liked: result.data.liked, like_count: result.data.like_count }
            : { ...item, liked: message.liked, like_count: message.like_count }
          : item,
      ),
    );
  }, []);

  const remove = useCallback(async (message: ChatMessage) => {
    const result = await api.deleteChat(message.id);
    if (result.ok) {
      setMessages((current) =>
        current.map((item) => (item.id === message.id ? { ...item, status: 'deleted', body: null } : item)),
      );
    }
    return result.ok ? null : result.error.message;
  }, []);

  return {
    signedIn: Boolean(userId),
    messages,
    loading,
    error,
    hasMore,
    connected,
    activeUsers,
    loadOlder,
    send,
    toggleLike,
    remove,
    refresh: fetchNewer,
  };
}
