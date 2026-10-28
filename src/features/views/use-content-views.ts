import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { useSession } from '@/stores/auth-store';
import { unwrap } from '@/utils/result';

import {
  DEFAULT_VIEW_SETTINGS,
  type AdminViewAnalytics,
  type ViewContentType,
  type ViewOwnerStats,
  type ViewRegistration,
  type ViewSettings,
} from './types';
import {
  fetchAdminViewAnalytics,
  fetchContentViewCounts,
  fetchOwnViewStats,
  fetchPublicViewSettings,
  registerContentViews as registerContentViewsRequest,
  updateAdminViewSettings,
  viewKey,
} from './views-service';

const COUNT_TTL_MS = 60_000;
/** İstemci tarafı oturum tekrarı: aynı içerik için gereksiz ağ turu atılmaz. */
const seenUntil = new Map<string, number>();
const countCache = new Map<string, { count: number; at: number }>();
const listeners = new Set<() => void>();
const queued = new Map<string, { type: ViewContentType; id: string }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const notify = () => {
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function bumpCount(type: ViewContentType, id: string, count: number) {
  if (!id) {
    return;
  }
  countCache.set(viewKey(type, id), { count, at: Date.now() });
  notify();
}

async function flushCounts() {
  flushTimer = null;
  const batch = Array.from(queued.values()).slice(0, 60);
  queued.clear();
  if (batch.length === 0) {
    return;
  }
  const result = await fetchContentViewCounts(batch);
  if (!result.ok) {
    // Erişim reddedilen içerikler için tekrar tekrar denemeyi engelle.
    for (const item of batch) {
      if (!countCache.has(viewKey(item.type, item.id))) {
        bumpCount(item.type, item.id, 0);
      }
    }
    return;
  }
  for (const row of result.data) {
    bumpCount(row.type, row.id, row.uniqueViews);
  }
  for (const item of batch) {
    if (!countCache.has(viewKey(item.type, item.id))) {
      bumpCount(item.type, item.id, 0);
    }
  }
}

function queueCount(type: ViewContentType, id: string) {
  const key = viewKey(type, id);
  if (queued.has(key)) {
    return;
  }
  queued.set(key, { type, id });
  if (flushTimer) {
    return;
  }
  // Aynı ekrandaki kartlar tek ağ turunda toplanır.
  flushTimer = setTimeout(() => {
    void flushCounts();
  }, 40);
}

/** Görünürlük eşiğini geçen içerikleri kaydeder; aynı oturumda tekrar denemez. */
export async function trackContentViews(items: ViewRegistration[]) {
  if (items.length === 0) {
    return;
  }
  if (AppState.currentState !== 'active') {
    return;
  }
  const now = Date.now();
  const pending = items.filter((item) => {
    if (!item.id) {
      return false;
    }
    const until = seenUntil.get(viewKey(item.type, item.id));
    return !until || until <= now;
  });
  if (pending.length === 0) {
    return;
  }

  const result = await registerContentViewsRequest(pending);
  if (!result.ok) {
    return;
  }

  result.data.forEach((row, index) => {
    const item = pending[index];
    if (!item) {
      return;
    }
    bumpCount(item.type, item.id, row.uniqueViews);
    const key = viewKey(item.type, item.id);
    if (row.counted) {
      // Sunucu tekilliği garantiler; istemci yalnızca gereksiz çağrıyı keser.
      seenUntil.set(key, Number.MAX_SAFE_INTEGER);
      return;
    }
    if (row.reason === 'owner' || row.reason === 'not_available' || row.reason === 'disabled') {
      seenUntil.set(key, now + 10 * 60_000);
    }
  });
}

/** Yönetici tarafından belirlenen görünürlük ve oynatma eşikleri. */
export function useViewSettings(): ViewSettings {
  const query = useQuery({
    queryKey: ['views', 'settings'],
    queryFn: async () => {
      const result = await fetchPublicViewSettings();
      if (!result.ok || !result.data) {
        return DEFAULT_VIEW_SETTINGS;
      }
      return { ...DEFAULT_VIEW_SETTINGS, ...result.data } as ViewSettings;
    },
    staleTime: 10 * 60_000,
  });
  return query.data ?? DEFAULT_VIEW_SETTINGS;
}

/**
 * Tekil sayaç. `initial` verilmişse (akış RPC'si zaten gönderiyorsa) ek ağ
 * isteği yapılmaz; aksi halde toplu sayaç okumasına eklenir.
 */
export function useContentViewCount(options: {
  type: ViewContentType;
  id: string | null | undefined;
  initial?: number | null;
}): number | null {
  const { type, id, initial } = options;
  const key = id ? viewKey(type, id) : '';
  const cached = useSyncExternalStore(
    subscribe,
    () => (key ? countCache.get(key)?.count : undefined),
    () => undefined,
  );

  useEffect(() => {
    if (!key || !id) {
      return;
    }
    if (typeof initial === 'number' && cached === undefined) {
      return;
    }
    const entry = countCache.get(key);
    if (entry && Date.now() - entry.at < COUNT_TTL_MS) {
      return;
    }
    queueCount(type, id);
  }, [key, id, type, initial, cached]);

  if (typeof cached === 'number') {
    return cached;
  }
  return typeof initial === 'number' ? initial : null;
}

/**
 * İçerik görünür olduğunda tekil görüntülemeyi kaydeder.
 *
 * `delayMs` admin eşiğinden gelir; ekran/komponent kapandığında zamanlayıcı
 * iptal edilir. Sunucu oturum + sahiplik + erişim + tekilliği doğrular.
 */
export function useContentViewRegistration(options: {
  type: ViewContentType;
  id: string | null | undefined;
  surface?: string;
  enabled?: boolean;
  delayMs?: number;
}) {
  const { type, id, surface, enabled = true, delayMs } = options;
  const session = useSession();
  const settings = useViewSettings();
  const threshold = delayMs ?? settings.min_visible_ms;
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!enabled || !id || !userId) {
      return;
    }
    const timer = setTimeout(() => {
      void trackContentViews([{ type, id, surface }]);
    }, Math.max(0, threshold));
    return () => clearTimeout(timer);
  }, [type, id, surface, enabled, userId, threshold]);
}

export function useOwnViewStats(
  type: ViewContentType | null,
  id: string | null,
  enabled = true,
) {
  return useQuery<ViewOwnerStats | null>({
    queryKey: ['views', 'owner', type, id],
    queryFn: async () => {
      if (!type || !id) {
        return null;
      }
      return unwrap(await fetchOwnViewStats(type, id));
    },
    enabled: enabled && Boolean(type && id),
    staleTime: 30_000,
  });
}

export function useAdminViewAnalytics() {
  return useQuery<AdminViewAnalytics>({
    queryKey: ['views', 'admin', 'analytics'],
    queryFn: async () => unwrap(await fetchAdminViewAnalytics()),
    staleTime: 60_000,
  });
}

export function useUpdateAdminViewSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<ViewSettings>) =>
      unwrap(await updateAdminViewSettings(settings)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['views'] });
    },
  });
}
