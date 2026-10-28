import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type { AdminAlertCategory, AdminAlertFeed, AdminAlertTone } from '../types';
import { adminKeys, mapAdminError } from './admin-service';

/**
 * Yönetim paneli baloncuk uyarıları.
 *
 * Tüm okumalar `admin_alert_feed` RPC'sinden geçer; RPC yalnızca çağıran
 * personelin yetkili olduğu kategorileri döndürür. Baloncuk kapatma ve
 * "tümünü temizle" işlemleri de kullanıcı bazlıdır.
 */

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) {
    return fail(mapAdminError(error));
  }
  return ok(data as unknown as T);
}

export const fetchAdminAlerts = (limit = 20) =>
  rpc<AdminAlertFeed>('admin_alert_feed', { p_limit: limit });

export const readAdminAlerts = (ids: string[]) => rpc<number>('admin_alert_read', { p_ids: ids });

export const readAllAdminAlerts = () => rpc<number>('admin_alert_read_all');

export { adminKeys };

/** Baloncuk ikonları tek yerden yönetilir; her kategori aynı görsel dili kullanır. */
export const ALERT_PRESENTATION: Record<
  AdminAlertCategory,
  { icon: ComponentProps<typeof Ionicons>['name']; label: string; tone: AdminAlertTone }
> = {
  report: { icon: 'flag-outline', label: 'Şikâyet', tone: 'warning' },
  child_safety: { icon: 'shield-half-outline', label: 'Çocuk güvenliği', tone: 'danger' },
  ticket: { icon: 'headset-outline', label: 'Destek', tone: 'info' },
  approval: { icon: 'checkmark-done-outline', label: 'Onay', tone: 'warning' },
  error: { icon: 'alert-circle-outline', label: 'Sistem', tone: 'danger' },
  privacy: { icon: 'mail-unread-outline', label: 'Veri talebi', tone: 'info' },
  deletion: { icon: 'trash-outline', label: 'Silme talebi', tone: 'warning' },
  order: { icon: 'bag-handle-outline', label: 'Sipariş', tone: 'info' },
  ride_verification: { icon: 'car-sport-outline', label: 'Doğrulama', tone: 'info' },
  ride_safety: { icon: 'warning-outline', label: 'Yolculuk güvenliği', tone: 'danger' },
  ride_dispute: { icon: 'scale-outline', label: 'Uyuşmazlık', tone: 'warning' },
  ride_booking: { icon: 'ticket-outline', label: 'Rezervasyon', tone: 'success' },
  content_report: { icon: 'image-outline', label: 'İçerik bildirimi', tone: 'warning' },
  custom: { icon: 'notifications-outline', label: 'Bildirim', tone: 'info' },
};
