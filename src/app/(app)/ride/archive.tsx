import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { shareRideStatement } from '@/features/documents';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { RideEmptyState } from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import { useMyTrips, useRideProfile } from '@/features/ride/hooks/use-ride';
import type { RideReservation } from '@/features/ride/types';
import { formatDateTime, formatMoney } from '@/features/ride/utils/format';

type Tab = 'completed' | 'cancelled' | 'driver';

const STATUS_LABEL: Record<string, string> = {
  completed: 'Tamamlandı',
  cancelled: 'İptal edildi',
  disputed: 'Uyuşmazlıkta',
  in_progress: 'Devam ediyor',
};

const PAYMENT_LABEL: Record<RideReservation['payment_status'], string> = {
  paid: 'Ödendi',
  unpaid: 'Ödenmedi',
  pending: 'Bekliyor',
  refunded: 'İade edildi',
  failed: 'Başarısız',
};

export default function RideArchiveScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const profile = useRideProfile();
  const trips = useMyTrips(null);
  const [tab, setTab] = useState<Tab>('completed');
  const [exporting, setExporting] = useState(false);

  const myId = profile.data?.user_id;

  const rows = useMemo(() => {
    const all = trips.data ?? [];
    if (tab === 'driver') return all.filter((trip) => trip.driver_id === myId);
    return all.filter((trip) => trip.status === tab);
  }, [trips.data, tab, myId]);

  const stats = useMemo(() => {
    const completed = (trips.data ?? []).filter((trip) => trip.status === 'completed');
    const spending = completed
      .filter((trip) => trip.passenger_id === myId && trip.payment_status === 'paid')
      .reduce((sum, trip) => sum + trip.total_cents, 0);
    const earnings = completed
      .filter((trip) => trip.driver_id === myId && trip.payment_status === 'paid')
      .reduce((sum, trip) => sum + trip.total_cents, 0);
    const refunded = (trips.data ?? [])
      .filter((trip) => trip.payment_status === 'refunded')
      .reduce((sum, trip) => sum + trip.total_cents, 0);
    const months = new Map<string, { trips: number; cents: number }>();
    for (const trip of completed) {
      const key = trip.depart_at.slice(0, 7);
      const bucket = months.get(key) ?? { trips: 0, cents: 0 };
      bucket.trips += 1;
      if (trip.passenger_id === myId) bucket.cents += trip.total_cents;
      months.set(key, bucket);
    }
    return {
      completed: completed.length,
      cancelled: (trips.data ?? []).filter((trip) => trip.status === 'cancelled').length,
      spending,
      earnings,
      refunded,
      months: [...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)),
    };
  }, [trips.data, myId]);

  const exportPdf = async () => {
    if (!rows.length) {
      Alert.alert('Dışa aktarılacak kayıt yok', 'Bu sekmede listelenecek yolculuk bulunmuyor.');
      return;
    }
    setExporting(true);
    try {
      const result = await shareRideStatement({
        trips: rows,
        userId: myId ?? '',
        scope: tab,
        ownerLabel: 'Yolculuk hesap özeti',
      });
      if (!result.ok) {
        Alert.alert('PDF oluşturulamadı', result.error.message);
      }
    } catch (cause) {
      Alert.alert('PDF oluşturulamadı', errorMessage(cause, 'Bilinmeyen hata'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Yolculuk arşivi"
        subtitle="Dijital özetler, ödeme kayıtları ve aylık raporlar"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="PDF dışa aktar"
            onPress={() => void exportPdf()}
            style={[
              styles.iconBtn,
              { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons
              name={exporting ? 'hourglass-outline' : 'download-outline'}
              size={19}
              color={theme.colors.primaryDeep}
            />
          </Pressable>
        }
      />

      <View style={styles.statGrid}>
        <StatChip
          label="Tamamlanan"
          value={String(stats.completed)}
          icon="checkmark-done-outline"
          tone="success"
        />
        <StatChip
          label="İptal"
          value={String(stats.cancelled)}
          icon="close-circle-outline"
          tone="danger"
        />
        <StatChip
          label="Harcama"
          value={formatMoney(stats.spending)}
          icon="wallet-outline"
          tone="primary"
        />
        <StatChip
          label="Tahsilat"
          value={formatMoney(stats.earnings)}
          icon="cash-outline"
          tone="accent"
        />
      </View>

      {stats.refunded > 0 ? (
        <Card padding={12} tone="muted">
          <AppText variant="caption" color="textSecondary">
            İade edilen toplam tutar: {formatMoney(stats.refunded)}. İadeler yalnızca ödeme
            sağlayıcısı işlemi onayladığında kesinleşir.
          </AppText>
        </Card>
      ) : null}

      <View style={styles.tabs}>
        {(
          [
            { key: 'completed', label: 'Tamamlanan' },
            { key: 'cancelled', label: 'İptal edilen' },
            { key: 'driver', label: 'Sürücü kayıtları' },
          ] as const
        ).map((item) => {
          const active = tab === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(item.key)}
              style={[
                styles.tab,
                {
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                },
              ]}
            >
              <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {trips.isLoading ? (
        <Card padding={18}>
          <AppText variant="body" color="textSecondary">
            Yükleniyor…
          </AppText>
        </Card>
      ) : trips.isError ? (
        <RideEmptyState
          icon="cloud-offline-outline"
          title="Arşiv yüklenemedi"
          message={trips.error.message}
          action={
            <Button label="Tekrar dene" variant="secondary" onPress={() => void trips.refetch()} />
          }
        />
      ) : rows.length === 0 ? (
        <RideEmptyState
          icon="archive-outline"
          title="Kayıt yok"
          message="Bu sekmede listelenecek yolculuk bulunmuyor."
          action={
            <Button
              label="Yolculuk ara"
              variant="secondary"
              onPress={() => router.navigate('/ride/search' as never)}
            />
          }
        />
      ) : (
        <View style={styles.list}>
          {rows.map((trip) => {
            const isDriver = trip.driver_id === myId;
            return (
              <Pressable
                key={trip.id}
                accessibilityRole="button"
                accessibilityLabel={`${trip.origin_label} - ${trip.dest_label} yolculuk özeti`}
                onPress={() => router.navigate(`/ride/trips/${trip.id}` as never)}
              >
                <Card padding={14} style={styles.card}>
                  <View style={styles.headRow}>
                    <View
                      style={[
                        styles.mark,
                        {
                          backgroundColor: isDriver
                            ? theme.colors.accentSoft
                            : theme.colors.primarySoft,
                        },
                      ]}
                    >
                      <Ionicons
                        name={isDriver ? 'car-outline' : 'person-outline'}
                        size={16}
                        color={isDriver ? theme.colors.accent : theme.colors.primaryDeep}
                      />
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="label" numberOfLines={1}>
                        {trip.origin_label} → {trip.dest_label}
                      </AppText>
                      <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                        {formatDateTime(trip.depart_at)} · {isDriver ? 'Sürücü' : 'Yolcu'}
                      </AppText>
                    </View>
                    <Badge
                      label={STATUS_LABEL[trip.status] ?? trip.status}
                      tone={
                        trip.status === 'completed'
                          ? 'success'
                          : trip.status === 'cancelled'
                            ? 'danger'
                            : 'neutral'
                      }
                    />
                  </View>
                  <View style={styles.footRow}>
                    <AppText variant="caption" color="textSecondary">
                      {trip.seats} koltuk · {formatMoney(trip.total_cents, trip.currency)}
                    </AppText>
                    <Badge
                      label={PAYMENT_LABEL[trip.payment_status]}
                      tone={
                        trip.payment_status === 'paid'
                          ? 'success'
                          : trip.payment_status === 'refunded'
                            ? 'accent'
                            : 'neutral'
                      }
                    />
                    <View style={styles.flex} />
                    <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
                  </View>
                  {trip.cancel_reason ? (
                    <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                      İptal nedeni: {trip.cancel_reason}
                    </AppText>
                  ) : null}
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}

      <Card padding={15} style={styles.months}>
        <AppText variant="title">Aylık istatistikler</AppText>
        {stats.months.length === 0 ? (
          <AppText variant="caption" color="textSecondary">
            Henüz tamamlanmış yolculuk yok.
          </AppText>
        ) : (
          stats.months.slice(0, 12).map(([month, bucket]) => (
            <View key={month} style={styles.monthRow}>
              <AppText variant="body" color="textSecondary" style={styles.flex}>
                {new Date(`${month}-01T00:00:00`).toLocaleDateString('tr-TR', {
                  month: 'long',
                  year: 'numeric',
                })}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {bucket.trips} yolculuk
              </AppText>
              <AppText variant="label">{formatMoney(bucket.cents)}</AppText>
            </View>
          ))
        )}
      </Card>

      <Card padding={12} tone="muted">
        <AppText variant="caption" color="textSecondary">
          Bu ekran yolculuk özeti ve kişisel raporlama içindir. PDF çıktısı yasal fatura değildir;
          doğrulanmış ödeme makbuzları yalnızca ödeme sağlayıcısının kayıtlarıyla eşleşen işlemler
          için üretilir.
        </AppText>
      </Card>
    </Screen>
  );
}

function StatChip({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'success' | 'danger' | 'primary' | 'accent';
}) {
  const { theme } = useTheme();
  const background =
    tone === 'success'
      ? theme.colors.successSoft
      : tone === 'danger'
        ? theme.colors.dangerSoft
        : tone === 'accent'
          ? theme.colors.accentSoft
          : theme.colors.primarySoft;
  const foreground =
    tone === 'success'
      ? theme.colors.success
      : tone === 'danger'
        ? theme.colors.danger
        : tone === 'accent'
          ? theme.colors.accent
          : theme.colors.primaryDeep;
  return (
    <View
      style={[
        styles.stat,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}
    >
      <View style={[styles.statIcon, { backgroundColor: background }]}>
        <Ionicons name={icon} size={15} color={foreground} />
      </View>
      <AppText variant="title" numberOfLines={1}>
        {value}
      </AppText>
      <AppText variant="caption" color="textTertiary" numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: {
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 4,
  },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: { flexDirection: 'row', gap: 6 },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  list: { gap: 9 },
  card: { gap: 9 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  mark: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  months: { gap: 8 },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
});
