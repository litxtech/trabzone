// Maç realtime kanalları.
//
//   • `sports-live` (herkese açık broadcast): sunucu maç verisi, yorum, anket,
//     taraftar medyası veya ayar değişince içeriksiz bir sinyal yollar
//     ({ fixture_id, kind, at }). Ekranlar ilgili sorgularını tazeler; veri
//     her zaman RPC'den okunur. Kanal süreç başına bir kez kurulur.
//   • `sports-chat:<id>` (private broadcast): sohbet mesajları. Yalnızca oturum
//     açmış kullanıcılar dinleyebilir (realtime.messages RLS politikası).
import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/services/supabase/client';

export type SportsLiveKind = 'fixture' | 'comments' | 'polls' | 'media' | 'settings' | 'standings';

export type SportsLiveSignal = { fixture_id: number | null; kind: SportsLiveKind; at: string };

type Listener = (signal: SportsLiveSignal) => void;

const listeners = new Set<Listener>();
let liveChannel: RealtimeChannel | null = null;

function ensureLiveChannel() {
  if (liveChannel) return;
  liveChannel = supabase
    .channel('sports-live')
    .on('broadcast', { event: 'update' }, (message) => {
      const payload = (message.payload ?? {}) as Partial<SportsLiveSignal>;
      if (!payload.kind) return;
      const signal: SportsLiveSignal = {
        fixture_id: payload.fixture_id == null ? null : Number(payload.fixture_id),
        kind: payload.kind,
        at: payload.at ?? new Date().toISOString(),
      };
      listeners.forEach((listener) => listener(signal));
    })
    .subscribe();
}

export function subscribeSportsLive(listener: Listener): () => void {
  listeners.add(listener);
  ensureLiveChannel();
  return () => {
    listeners.delete(listener);
  };
}

export type ChatRealtimeEvent =
  | { event: 'message'; payload: Record<string, unknown> }
  | { event: 'remove'; payload: { id: number; status: string } }
  | { event: 'like'; payload: { id: number; like_count: number } }
  | { event: 'sanction'; payload: { user_id: string; kind: string } }
  | { event: 'room'; payload: Record<string, unknown> };

/**
 * Private sohbet kanalına bağlanır. Bağlantı kurulamazsa `onStatus(false)`
 * çağrılır ve çağıran taraf aralıklı sorguya (polling) geçer.
 */
export function subscribeChat(
  fixtureId: number,
  onEvent: (event: ChatRealtimeEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let disposed = false;
  let channel: RealtimeChannel | null = null;

  const connect = async () => {
    const { data } = await supabase.auth.getSession();
    if (disposed) return;
    if (data.session?.access_token) {
      await supabase.realtime.setAuth(data.session.access_token);
    }
    if (disposed) return;
    channel = supabase.channel(`sports-chat:${fixtureId}`, { config: { private: true } });
    for (const name of ['message', 'remove', 'like', 'sanction', 'room'] as const) {
      channel.on('broadcast', { event: name }, (message) => {
        onEvent({ event: name, payload: (message.payload ?? {}) as never });
      });
    }
    channel.subscribe((status) => {
      if (disposed) return;
      onStatus(status === 'SUBSCRIBED');
    });
  };

  void connect();
  return () => {
    disposed = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
