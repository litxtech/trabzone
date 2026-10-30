import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, IconButton } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/theme/ThemeProvider';

import { RideEmptyState, RideRouteBlock, StatusPill } from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import { useMyOffers, useMyTrips } from '@/features/ride/hooks/use-ride';
import type { ReservationStatus } from '@/features/ride/types';
import { SCOPE_LABEL, formatDate, formatMoney, formatTime } from '@/features/ride/utils/format';

type Role = 'passenger' | 'driver';
type Tab = 'upcoming' | 'active' | 'completed' | 'cancelled';

const TABS: { key: Tab; label: string }[] = [
  { key: 'upcoming', label: 'Yaklaşan' },
  { key: 'active', label: 'Devam eden' },
  { key: 'completed', label: 'Geçmiş' },
  { key: 'cancelled', label: 'İptal' },
];

const INACTIVE: ReservationStatus[] = ['cancelled', 'rejected', 'expired'];

function tripHint(
  status: ReservationStatus,
  boardedAt: string | null,
  departAt: string,
  mountedAt: number,
): { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; tone: 'success' | 'accent' | 'warning' } | null {
  if (status === 'confirmed' && !boardedAt) {
    if (new Date(departAt).getTime() < mountedAt) {
      return {
        icon: 'alert-circle-outline',
        text: 'Kalkış saati geçti; sürücüyle iletişime geç.',
        tone: 'warning',
      };
    }
    return { icon: 'qr-code-outline', text: 'Biniş kodun hazır.', tone: 'success' };
  }
  if (status === 'started') {
    return { icon: 'navigate-outline', text: 'Yolculuk devam ediyor.', tone: 'accent' };
  }
  return null;
}

export default function RideTripsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [role, setRole] = useState<Role>('passenger');
  const [tab, setTab] = useState<Tab>('upcoming');
  // Snapshot the clock once per mount so render stays pure.
  const [mountedAt] = useState(() => Date.now());
  const trips = useMyTrips(tab, role === 'passenger');
  const offers = useMyOffers(role === 'driver');

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      scroll
      padded
      contentContainerStyle={styles.page}
    >
      <RideHeader
        title="Yolculuklar"
        subtitle="Yolcu rezervasyonları ve sürücü ilanların"
        right={
          <View style={styles.headerActions}>
            <IconButton
              name="car-outline"
              accessibilityLabel="Garajım"
              variant="surface"
              size={19}
              onPress={() => router.navigate('/ride/garage' as never)}
            />
            <IconButton
              name="search-outline"
              accessibilityLabel="Yolculuk ara"
              variant="surface"
              size={19}
              onPress={() => router.navigate('/ride/search' as never)}
            />
          </View>
        }
      />

      <View style={[styles.roleSegment, { backgroundColor: theme.colors.surfaceMuted }]}>
        {(['passenger', 'driver'] as Role[]).map((item) => {
          const active = role === item;
          return (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setRole(item)}
              style={[
                styles.roleItem,
                {
                  backgroundColor: active ? theme.colors.surface : 'transparent',
                  borderColor: active ? theme.colors.border : 'transparent',
                },
              ]}
            >
              <Ionicons
                name={item === 'passenger' ? 'person-outline' : 'car-outline'}
                size={15}
                color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
              />
              <AppText variant="label" color={active ? 'primaryDeep' : 'textTertiary'}>
                {item === 'passenger' ? 'Yolcu' : 'Sürücü'}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {role === 'passenger' ? (
        <>
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
                    {
                      backgroundColor: active ? theme.colors.primarySoft : 'transparent',
                      borderColor: active ? theme.colors.primary : 'transparent',
                    },
                  ]}
                >
                  <AppText
                    variant="caption"
                    color={active ? 'primaryDeep' : 'textSecondary'}
                    numberOfLines={1}
                  >
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
              action={
                <Button
                  label="Tekrar dene"
                  variant="secondary"
                  size="sm"
                  fullWidth={false}
                  onPress={() => void trips.refetch()}
                />
              }
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
                      ? 'Geçmiş yolculuk yok'
                      : 'İptal edilen yolculuk yok'
              }
              message={
                tab === 'upcoming'
                  ? 'Uygun bir yolculuk bulduğunda rezervasyonun burada görünür.'
                  : 'Bu sekmede gösterilecek bir kayıt bulunmuyor.'
              }
              action={
                tab === 'upcoming' ? (
                  <Button
                    label="Yolculuk ara"
                    size="sm"
                    fullWidth={false}
                    onPress={() => router.navigate('/ride/search' as never)}
                  />
                ) : undefined
              }
            />
          ) : (
            <View style={styles.list}>
              {trips.data?.map((trip) => {
                const hint = tripHint(trip.status, trip.boarded_at, trip.depart_at, mountedAt);
                return (
                  <Pressable
                    key={trip.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${trip.origin_label} ${trip.dest_label}`}
                    onPress={() => router.navigate(`/ride/trips/${trip.id}` as never)}
                    style={({ pressed }) => [
                      styles.card,
                      {
                        backgroundColor: theme.colors.surface,
                        borderColor: theme.colors.border,
                        opacity: pressed ? 0.86 : 1,
                      },
                    ]}
                  >
                    <View style={styles.cardTop}>
                      <View style={styles.flex}>
                        <RideRouteBlock
                          origin={trip.origin_label}
                          dest={trip.dropoff_label}
                          emphasis
                        />
                      </View>
                      <StatusPill status={trip.status} />
                    </View>

                    <View style={styles.metaRow}>
                      <View style={styles.meta}>
                        <Ionicons
                          name="calendar-outline"
                          size={13}
                          color={theme.colors.textTertiary}
                        />
                        <AppText variant="caption" color="textSecondary">
                          {formatDate(trip.depart_at)} · {formatTime(trip.depart_at)}
                        </AppText>
                      </View>
                      <View style={styles.meta}>
                        <Ionicons
                          name="ticket-outline"
                          size={13}
                          color={theme.colors.textTertiary}
                        />
                        <AppText variant="caption" color="textSecondary">
                          {trip.seats} koltuk
                        </AppText>
                      </View>
                      <View style={styles.flex} />
                      <AppText variant="label" color="primaryDeep">
                        {formatMoney(trip.total_cents, trip.currency)}
                      </AppText>
                    </View>

                    <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />

                    <View style={styles.cardFoot}>
                      <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                        {SCOPE_LABEL[trip.scope]} ·{' '}
                        {trip.payment_method === 'cash' ? 'Yolculukta ödeme' : 'Kartla ödeme'}
                      </AppText>
                      <View style={styles.flex} />
                      {hint ? (
                        <View style={styles.hintRow}>
                          <Ionicons
                            name={hint.icon}
                            size={13}
                            color={
                              hint.tone === 'warning'
                                ? theme.colors.warning
                                : hint.tone === 'accent'
                                  ? theme.colors.accent
                                  : theme.colors.success
                            }
                          />
                          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                            {hint.text}
                          </AppText>
                        </View>
                      ) : INACTIVE.includes(trip.status) ? (
                        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                          {trip.cancel_reason ?? 'Etkin değil'}
                        </AppText>
                      ) : null}
                      <Ionicons
                        name="chevron-forward"
                        size={15}
                        color={theme.colors.textTertiary}
                      />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      ) : (
        <>
          <View style={styles.driverHead}>
            <AppText variant="title" style={styles.flex}>
              Sürücü ilanların
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Yeni ilan oluştur"
              onPress={() => router.navigate('/ride/create' as never)}
              style={[styles.newButton, { backgroundColor: theme.colors.primarySoft }]}
            >
              <Ionicons name="add" size={15} color={theme.colors.primaryDeep} />
              <AppText variant="label" color="primaryDeep">
                Yeni ilan
              </AppText>
            </Pressable>
          </View>

          {offers.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : offers.isError ? (
            <RideEmptyState
              icon="cloud-offline-outline"
              title="İlanlar yüklenemedi"
              message={offers.error.message}
              action={
                <Button
                  label="Tekrar dene"
                  variant="secondary"
                  size="sm"
                  fullWidth={false}
                  onPress={() => void offers.refetch()}
                />
              }
            />
          ) : (offers.data?.length ?? 0) === 0 ? (
            <RideEmptyState
              icon="car-sport-outline"
              title="Henüz ilanın yok"
              message="Sürücü doğrulaman onaylıysa araçla ilan verip koltuk açabilirsin."
              action={
                <Button
                  label="İlan oluştur"
                  size="sm"
                  fullWidth={false}
                  onPress={() => router.navigate('/ride/create' as never)}
                />
              }
            />
          ) : (
            <View style={styles.list}>
              {offers.data?.map((offer) => (
                <Pressable
                  key={offer.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${offer.origin_label} ${offer.dest_label} ilanı`}
                  onPress={() => router.navigate(`/ride/offers/${offer.id}` as never)}
                  style={({ pressed }) => [
                    styles.card,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.border,
                      opacity: pressed ? 0.86 : 1,
                    },
                  ]}
                >
                  <View style={styles.cardTop}>
                    <View style={styles.flex}>
                      <RideRouteBlock
                        origin={offer.origin_label}
                        dest={offer.dest_label}
                        emphasis
                      />
                    </View>
                    <StatusPill status={offer.status} />
                  </View>

                  <View style={styles.metaRow}>
                    <View style={styles.meta}>
                      <Ionicons
                        name="calendar-outline"
                        size={13}
                        color={theme.colors.textTertiary}
                      />
                      <AppText variant="caption" color="textSecondary">
                        {formatDate(offer.depart_at)} · {formatTime(offer.depart_at)}
                      </AppText>
                    </View>
                    <View style={styles.meta}>
                      <Ionicons
                        name="people-outline"
                        size={13}
                        color={theme.colors.textTertiary}
                      />
                      <AppText variant="caption" color="textSecondary">
                        {offer.seats_total} koltuk
                      </AppText>
                    </View>
                    <View style={styles.flex} />
                    <AppText variant="label" color="primaryDeep">
                      {formatMoney(offer.price_per_seat_cents, offer.currency)}
                    </AppText>
                  </View>

                  <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />

                  <View style={styles.cardFoot}>
                    <View style={styles.pillRow}>
                      {offer.requested_count > 0 ? (
                        <Badge label={`${offer.requested_count} talep`} tone="warning" />
                      ) : (
                        <AppText variant="caption" color="textTertiary">
                          Talep bekleniyor
                        </AppText>
                      )}
                      {offer.confirmed_count > 0 ? (
                        <Badge label={`${offer.confirmed_count} onaylı`} tone="success" />
                      ) : null}
                    </View>
                    <View style={styles.flex} />
                    <Ionicons
                      name="chevron-forward"
                      size={15}
                      color={theme.colors.textTertiary}
                    />
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 880, alignSelf: 'center', gap: 13 },
  flex: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roleSegment: { flexDirection: 'row', padding: 3, borderRadius: 12, gap: 3 },
  roleItem: {
    flex: 1,
    minHeight: 38,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  tabs: { flexDirection: 'row', gap: 5 },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  center: { paddingVertical: 44, alignItems: 'center' },
  list: { gap: 8 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    gap: 9,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  divider: { height: StyleSheet.hairlineWidth },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '62%' },
  driverHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
});
