import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/theme/ThemeProvider';

import { RideEmptyState, StatusPill } from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import { useMyOffers, useMyTrips } from '@/features/ride/hooks/use-ride';
import type { ReservationStatus } from '@/features/ride/types';
import { formatDate, formatMoney, formatTime, SCOPE_LABEL } from '@/features/ride/utils/format';

type Tab = 'upcoming' | 'active' | 'completed' | 'cancelled';

const TABS: { key: Tab; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'upcoming', label: 'Yaklaşan', icon: 'calendar-outline' },
  { key: 'active', label: 'Devam eden', icon: 'navigate-outline' },
  { key: 'completed', label: 'Tamamlanan', icon: 'checkmark-done-outline' },
  { key: 'cancelled', label: 'İptal', icon: 'close-circle-outline' },
];

const INACTIVE: ReservationStatus[] = ['cancelled', 'rejected', 'expired'];

export default function RideTripsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('upcoming');
  // Snapshot the clock once per mount so render stays pure.
  const [mountedAt] = useState(() => Date.now());
  const trips = useMyTrips(tab);
  const offers = useMyOffers();

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Yolculuklarım"
        subtitle="Yolcu rezervasyonları ve sürücü ilanların"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yolculuk ara"
            onPress={() => router.navigate('/ride/search' as never)}
            style={[styles.iconBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          >
            <Ionicons name="search-outline" size={18} color={theme.colors.text} />
          </Pressable>
        }
      />

      <View style={styles.tabs}>
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(item.key)}
              style={[
                styles.tab,
                { backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={14}
                color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
              />
              <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'} numberOfLines={1}>
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {trips.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : trips.isError ? (
        <RideEmptyState
          icon="cloud-offline-outline"
          title="Yolculuklar yüklenemedi"
          message={trips.error.message}
          action={<Button label="Tekrar dene" variant="secondary" onPress={() => void trips.refetch()} />}
        />
      ) : (trips.data?.length ?? 0) === 0 ? (
        <RideEmptyState
          icon={tab === 'active' ? 'navigate-outline' : 'car-outline'}
          title={
            tab === 'upcoming'
              ? 'Yaklaşan yolculuk yok'
              : tab === 'active'
                ? 'Devam eden yolculuk yok'
                : tab === 'completed'
                  ? 'Tamamlanan yolculuk yok'
                  : 'İptal edilen yolculuk yok'
          }
          message={
            tab === 'upcoming'
              ? 'Uygun bir yolculuk bulduğunda rezervasyonun burada görünür.'
              : 'Bu sekmede gösterilecek bir kayıt bulunmuyor.'
          }
          action={
            tab === 'upcoming' ? (
              <Button label="Yolculuk ara" onPress={() => router.navigate('/ride/search' as never)} />
            ) : undefined
          }
        />
      ) : (
        <View style={styles.list}>
          {trips.data?.map((trip) => {
            const depart = new Date(trip.depart_at);
            return (
              <Pressable
                key={trip.id}
                accessibilityRole="button"
                accessibilityLabel={`${trip.origin_label} ${trip.dest_label}`}
                onPress={() => router.navigate(`/ride/trips/${trip.id}` as never)}
                style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
              >
                <Card padding={15} style={styles.tripCard}>
                  <View style={styles.tripHead}>
                    <View style={styles.flex}>
                      <AppText variant="title" numberOfLines={1}>{trip.origin_city} → {trip.dest_city}</AppText>
                      <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                        {trip.origin_label} → {trip.dropoff_label}
                      </AppText>
                    </View>
                    <StatusPill status={trip.status} />
                  </View>
                  <View style={styles.metaRow}>
                    <View style={styles.meta}>
                      <Ionicons name="calendar-outline" size={14} color={theme.colors.textTertiary} />
                      <AppText variant="caption" color="textSecondary">
                        {formatDate(trip.depart_at)} · {formatTime(trip.depart_at)}
                      </AppText>
                    </View>
                    <View style={styles.meta}>
                      <Ionicons name="ticket-outline" size={14} color={theme.colors.textTertiary} />
                      <AppText variant="caption" color="textSecondary">{trip.seats} koltuk</AppText>
                    </View>
                    <View style={styles.meta}>
                      <Ionicons name="cash-outline" size={14} color={theme.colors.textTertiary} />
                      <AppText variant="caption" color="textSecondary">
                        {formatMoney(trip.total_cents, trip.currency)}
                      </AppText>
                    </View>
                  </View>
                  <View style={styles.tripFoot}>
                    <Badge label={SCOPE_LABEL[trip.scope]} tone="neutral" />
                    <Badge
                      label={trip.payment_method === 'cash' ? 'Yolculukta ödeme' : 'Kartla ödeme'}
                      tone={trip.payment_status === 'paid' ? 'success' : 'neutral'}
                    />
                    <View style={styles.flex} />
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
                  </View>
                  {INACTIVE.includes(trip.status) ? (
                    <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                      {trip.cancel_reason ?? 'Bu rezervasyon artık etkin değil.'}
                    </AppText>
                  ) : null}
                  {trip.status === 'confirmed' && !trip.boarded_at ? (
                    <View style={[styles.hint, { backgroundColor: theme.colors.successSoft }]}>
                      <Ionicons name="qr-code-outline" size={15} color={theme.colors.success} />
                      <AppText variant="caption" color="textSecondary" style={styles.flex}>
                        Biniş kodun hazır. Yolculuk günü sürücüye kodu göster.
                      </AppText>
                    </View>
                  ) : null}
                  {trip.status === 'started' ? (
                    <View style={[styles.hint, { backgroundColor: theme.colors.accentSoft }]}>
                      <Ionicons name="navigate" size={15} color={theme.colors.accent} />
                      <AppText variant="caption" color="textSecondary" style={styles.flex}>
                        Yolculuk devam ediyor. Canlı takip ve SOS için dokun.
                      </AppText>
                    </View>
                  ) : null}
                  {trip.depart_at && depart.getTime() < mountedAt && trip.status === 'confirmed' ? (
                    <AppText variant="caption" color="warning">Kalkış saati geçti; sürücüyle iletişime geç.</AppText>
                  ) : null}
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <AppText variant="h3">Sürücü ilanların</AppText>
          <View style={styles.flex} />
          <Button
            label="Yeni ilan"
            size="sm"
            fullWidth={false}
            onPress={() => router.navigate('/ride/create' as never)}
          />
        </View>
        {offers.isLoading ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (offers.data?.length ?? 0) === 0 ? (
          <Card padding={14} tone="muted">
            <AppText variant="body" color="textSecondary">
              Henüz ilan yayınlamadın. Sürücü doğrulaman onaylıysa hemen ilan oluşturabilirsin.
            </AppText>
          </Card>
        ) : (
          offers.data?.map((offer) => (
            <Pressable
              key={offer.id}
              onPress={() => router.navigate(`/ride/offers/${offer.id}` as never)}
              style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
            >
              <Card padding={14}>
                <View style={styles.tripHead}>
                  <View style={styles.flex}>
                    <AppText variant="label" numberOfLines={1}>
                      {offer.origin_label} → {offer.dest_label}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {formatDate(offer.depart_at)} · {formatTime(offer.depart_at)} · {offer.seats_total} koltuk
                    </AppText>
                  </View>
                  <StatusPill status={offer.status} />
                </View>
                <View style={styles.metaRow}>
                  <Badge label={`${offer.requested_count} talep`} tone={offer.requested_count > 0 ? 'warning' : 'neutral'} />
                  <Badge label={`${offer.confirmed_count} onaylı`} tone="success" />
                  <View style={styles.flex} />
                  <AppText variant="label" color="primaryDeep">
                    {formatMoney(offer.price_per_seat_cents, offer.currency)}
                  </AppText>
                </View>
              </Card>
            </Pressable>
          ))
        )}
      </View>
    </Screen>
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
  tabs: { flexDirection: 'row', gap: 6 },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  center: { paddingVertical: 50, alignItems: 'center' },
  list: { gap: 10 },
  tripCard: { gap: 9 },
  tripHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  metaRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tripFoot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  section: { gap: 10, paddingTop: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
