import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { usePropertyActivity, usePropertyDetail } from '../hooks/use-accommodation';
import type { ActivityEntry } from '../types';
import { formatDateTime } from '../utils/format';
import {
  AccCard,
  Chip,
  EmptyState,
  InlineError,
  InfoBanner,
  LoadingBlock,
} from './AccommodationUI';

const ACTION_LABELS: Record<string, string> = {
  'reservation.created': 'Yeni rezervasyon oluşturuldu',
  'reservation.confirmed': 'Rezervasyon onaylandı',
  'reservation.declined': 'Rezervasyon reddedildi',
  'reservation.cancelled': 'Rezervasyon iptal edildi',
  'reservation.cancel': 'Rezervasyon iptal edildi',
  'reservation.check_in': 'Misafir giriş yaptı',
  'reservation.check_out': 'Misafir çıkış yaptı',
  'reservation.no_show': 'Rezervasyon no-show işaretlendi',
  'reservation.updated': 'Rezervasyon güncellendi',
  'payment.recorded': 'Ödeme kaydedildi',
  'cash.transaction': 'Kasa hareketi oluşturuldu',
  'review_published': 'Yorum yayınlandı',
  'review_hidden': 'Yorum gizlendi',
  'document.created': 'Belge oluşturuldu',
};

const ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  reservation: 'calendar-outline',
  payment: 'card-outline',
  cash: 'wallet-outline',
  review: 'star-outline',
  document: 'document-text-outline',
  staff: 'people-outline',
  property: 'business-outline',
};

function labelFor(entry: ActivityEntry): string {
  return ACTION_LABELS[entry.action] ?? entry.action.replace(/[._]/g, ' ');
}

function iconFor(entry: ActivityEntry): React.ComponentProps<typeof Ionicons>['name'] {
  const prefix = entry.action.split(/[._]/)[0] ?? '';
  return ICONS[prefix] ?? 'notifications-outline';
}

export function NotificationsCenter({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const activity = usePropertyActivity(propertyId, 80);
  const detail = usePropertyDetail(propertyId);
  const [filter, setFilter] = useState<'all' | 'reservation' | 'finance' | 'review'>('all');

  const items = activity.data?.items ?? [];
  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'finance') return items.filter((entry) => /payment|cash|invoice|document/.test(entry.action));
    if (filter === 'review') return items.filter((entry) => /review/.test(entry.action));
    return items.filter((entry) => /reservation|frontdesk/.test(entry.action));
  }, [items, filter]);

  const settings = detail.data?.settings ?? {};

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Bildirimler</AppText>
          <AppText variant="caption" color="textTertiary">Tesis hareketleri ve bildirim tercihleri</AppText>
        </View>
        <Button label="Yenile" size="sm" variant="outline" fullWidth={false} loading={activity.isFetching} onPress={() => void activity.refetch()} />
      </View>

      <View style={styles.channels}>
        <ChannelPill label="Rezervasyon" active={Boolean(settings.notify_new_reservation)} />
        <ChannelPill label="İptal" active={Boolean(settings.notify_cancellation)} />
        <ChannelPill label="Mesaj" active={Boolean(settings.notify_messages)} />
        <ChannelPill label="Otomatik çıkış" active={Boolean(settings.auto_checkout)} />
      </View>

      <InfoBanner text="Bildirim tercihlerini “Otel ayarları” bölümünden değiştirebilirsin. Aşağıdaki akış tesisin son işlem kayıtlarını gösterir ve denetim amacıyla saklanır." />

      <View style={styles.filters}>
        {(
          [
            { value: 'all', label: 'Tümü' },
            { value: 'reservation', label: 'Rezervasyon' },
            { value: 'finance', label: 'Finans' },
            { value: 'review', label: 'Yorum' },
          ] as { value: typeof filter; label: string }[]
        ).map((entry) => (
          <Chip key={entry.value} label={entry.label} active={filter === entry.value} onPress={() => setFilter(entry.value)} />
        ))}
      </View>

      {activity.isLoading ? (
        <LoadingBlock height={220} />
      ) : activity.isError ? (
        <InlineError
          message={activity.error instanceof Error ? activity.error.message : 'Bildirimler yüklenemedi.'}
          onRetry={() => void activity.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="Bildirim yok"
          message="Rezervasyon, ödeme veya yorum gibi işlemler gerçekleştikçe burada listelenir."
          compact
        />
      ) : (
        <AccCard padding={0} style={styles.list}>
          {filtered.map((entry, index) => (
            <View
              key={entry.id}
              style={[
                styles.row,
                {
                  borderBottomColor: theme.colors.divider,
                  borderBottomWidth: index === filtered.length - 1 ? 0 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <View style={[styles.icon, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Ionicons name={iconFor(entry)} size={15} color={theme.colors.primary} />
              </View>
              <View style={styles.flex}>
                <AppText variant="body" numberOfLines={2}>{labelFor(entry)}</AppText>
                <AppText variant="caption" color="textTertiary">
                  {entry.actor_name ? `${entry.actor_name} · ` : ''}
                  {formatDateTime(entry.created_at)}
                </AppText>
              </View>
              {typeof entry.detail?.amount_cents === 'number' ? (
                <AppText variant="caption" color="textSecondary">
                  {new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(
                    entry.detail.amount_cents / 100,
                  )}
                </AppText>
              ) : null}
            </View>
          ))}
        </AccCard>
      )}
    </View>
  );
}

function ChannelPill({ label, active }: { label: string; active: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.channel, { backgroundColor: active ? theme.colors.successSoft : theme.colors.surfaceMuted }]}>
      <Ionicons
        name={active ? 'checkmark-circle' : 'close-circle'}
        size={13}
        color={active ? theme.colors.success : theme.colors.textTertiary}
      />
      <AppText variant="caption" color={active ? 'success' : 'textTertiary'}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  channels: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  channel: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  filters: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  list: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11 },
  icon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
