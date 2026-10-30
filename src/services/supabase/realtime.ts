import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from './client';

let counter = 0;

/**
 * `postgres_changes` dinlemeleri için benzersiz konulu kanal üretir.
 *
 * `supabase.channel(topic)` aynı konu için **var olan** kanal örneğini döndürür.
 * `removeChannel` asenkron olduğu için React StrictMode'un çift mount'unda veya
 * iki ekran aynı anda bağlandığında ikinci `.on('postgres_changes', …)` çağrısı
 * şu hatayı veriyordu:
 *
 *   cannot add `postgres_changes` callbacks for realtime:<topic> after
 *   `subscribe()`
 *
 * Konu adı `postgres_changes` için serbesttir: yetkilendirme tablo/RLS
 * üzerinden yapılır, sunucu konu adına bakmaz. Bu yüzden her abonelik kısa bir
 * sayaç son eki alır ve çakışma olamaz.
 *
 * Broadcast/presence kanalları (sunucunun `realtime.send` ile yolladığı sabit
 * konular: `sports-live`, `earthquake-feed`, `legal-policies`,
 * `sports-chat:<id>`) bu yardımcıyı **kullanmamalıdır**; onların konu adı
 * sunucu tarafıyla birebir eşleşmek zorundadır.
 */
export function postgresChannel(topic: string): RealtimeChannel {
  counter = (counter + 1) % 1_000_000;
  return supabase.channel(`${topic}:${counter}`);
}
