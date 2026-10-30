import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Avatar, Badge, Button, Card, SelectSheet } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { availableSeatCount, normalizeSeatSelection, occupiedSeatSet } from '@/features/pricing';
import { useAuthStore } from '@/stores/auth-store';
import { errorMessage } from '@/services/errors';
import { useContentViewCount, useContentViewRegistration } from '@/features/views/use-content-views';
import { ViewCount } from '@/features/views/components/ViewCount';

import {
  VERIFIED_BLUE,
  VerifiedChip,
  VerifiedTick,
} from '@/features/ride/components/IdentityBadge';
import {
  LevelBadge,
  PreferenceChips,
  RideEmptyState,
  RideSection,
  StatusPill,
} from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import { RideMapPreview } from '@/features/ride/components/RideMapPreview';
import { RouteTimeline } from '@/features/ride/components/RouteTimeline';
import { SeatMap } from '@/features/ride/components/SeatMap';
import {
  useCancelReservation,
  useJoinWaitlist,
  useLeaveWaitlist,
  useOfferReservations,
  useReserveSeats,
  useRideOffer,
  useRideProfile,
  useRidePublicConfig,
  useRideWaitlistOffers,
  useAcceptWaitlistOffer,
  useStartOffer,
  useCompleteOffer,
} from '@/features/ride/hooks/use-ride';
import { rideVehiclePhotoUrl } from '@/features/ride/services/ride-service';
import { formatDate, formatDuration, formatMoney, formatTime } from '@/features/ride/utils/format';
import { isIdentityVerified } from '@/features/ride/utils/identity';
import { useTheme } from '@/theme/ThemeProvider';

const FUEL: Record<string, string> = {
  gasoline: 'Benzin',
  diesel: 'Dizel',
  lpg: 'LPG',
  hybrid: 'Hibrit',
  electric: 'Elektrik',
};

const LUGGAGE: Record<string, string> = {
  small: 'Küçük bagaj',
  medium: 'Orta bagaj',
  large: 'Büyük bagaj',
};

export default function RideOfferDetailScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const offerId = String(params.id ?? '');
  const session = useAuthStore((state) => state.session);
  // Sorgu, görüntüleme kaydından önce tanımlanmalı: kayıt `offerQuery.data`
  // üzerinden aktifleşiyor (önce tanımlanmazsa TDZ hatası veriyordu).
  const offerQuery = useRideOffer(offerId || null);
  const rideViewCount = useContentViewCount({ type: 'ride_offer', id: offerId || null });
  useContentViewRegistration({
    type: 'ride_offer',
    id: offerId || null,
    surface: 'ride_offer_detail',
    enabled: Boolean(offerQuery.data),
  });

  const profile = useRideProfile();
  const config = useRidePublicConfig();
  const waitlistOffers = useRideWaitlistOffers();
  const reservations = useOfferReservations(offerQuery.data?.is_driver ? offerId : null);

  const reserve = useReserveSeats();
  const cancel = useCancelReservation();
  const joinWaitlist = useJoinWaitlist();
  const leaveWaitlist = useLeaveWaitlist();
  const acceptWaitlist = useAcceptWaitlistOffer();
  const startOffer = useStartOffer();
  const completeOffer = useCompleteOffer();

  const [pickupSeq, setPickupSeq] = useState(0);
  const [dropoffSeq, setDropoffSeq] = useState<number | null>(null);
  const [seats, setSeats] = useState(1);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [payment, setPayment] = useState<'cash' | 'card'>('cash');
  const [note, setNote] = useState('');
  const [extraNames, setExtraNames] = useState<string[]>([]);
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);
  const [dropoffOpen, setDropoffOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotency = useRef<string | null>(null);

  const offer = offerQuery.data;
  const maxSeq = useMemo(() => {
    if (!offer?.stops.length) {
      return 1;
    }
    return Math.max(...offer.stops.map((stop) => stop.seq));
  }, [offer]);

  const pickupSeqValue = Math.min(pickupSeq, Math.max(maxSeq - 1, 0));
  const dropoffSeqValue = dropoffSeq ?? maxSeq;

  const segmentAvailability = useMemo(
    () => availableSeatCount(offer?.availability, pickupSeqValue, dropoffSeqValue),
    [offer, pickupSeqValue, dropoffSeqValue],
  );

  const effectiveSeats = Math.max(1, Math.min(seats, Math.max(segmentAvailability, 1)));
  const effectiveSelectedSeats = useMemo(
    () =>
      normalizeSeatSelection({
        selected: selectedSeats,
        seatsTotal: offer?.availability.seats_total ?? 0,
        capacity: effectiveSeats,
        occupied: occupiedSeatSet(offer?.availability, pickupSeqValue, dropoffSeqValue),
      }),
    [selectedSeats, offer, effectiveSeats, pickupSeqValue, dropoffSeqValue],
  );
  const extraNameSlots = Array.from(
    { length: Math.max(effectiveSeats - 1, 0) },
    (_, index) => extraNames[index] ?? '',
  );
  const myReservation = offer?.my_reservation_id
    ? {
        id: offer.my_reservation_id,
        status: offer.my_reservation_status,
      }
    : null;
  const waitlistOffer = waitlistOffers.data?.find((item) => item.offer_id === offerId) ?? null;
  const isDriver = offer?.is_driver ?? false;
  const identityApproved = isIdentityVerified(profile.data);
  const cardEnabled = config.data?.card_payments_enabled === true;
  const selfName =
    (session?.user.user_metadata?.full_name as string | undefined) ??
    (session?.user.user_metadata?.first_name as string | undefined) ??
    'Yolcu';

  if (offerQuery.isLoading) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']} padded>
        <RideHeader title="Yolculuk" />
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
          <AppText variant="caption" color="textTertiary">
            İlan yükleniyor…
          </AppText>
        </View>
      </Screen>
    );
  }

  if (offerQuery.isError || !offer) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']} padded>
        <RideHeader title="Yolculuk" />
        <RideEmptyState
          icon="alert-circle-outline"
          title="İlan açılamadı"
          message={offerQuery.error?.message ?? 'İlan bulunamadı veya erişim yetkin yok.'}
          action={<Button label="Geri dön" variant="secondary" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const pickupOptions = offer.stops
    .filter((stop) => stop.seq < dropoffSeqValue)
    .map((stop) => `${stop.seq}|${stop.label}`);
  const dropoffOptions = offer.stops
    .filter((stop) => stop.seq > pickupSeqValue)
    .map((stop) => `${stop.seq}|${stop.label}`);
  const pickupStop = offer.stops.find((stop) => stop.seq === pickupSeqValue);
  const dropoffStop = offer.stops.find((stop) => stop.seq === dropoffSeqValue);
  const total = offer.price_per_seat_cents * effectiveSeats;
  const occupancy = offer.availability.seats_total - segmentAvailability;
  const isFull = segmentAvailability <= 0;
  const canReserve =
    !isDriver &&
    !myReservation &&
    !isFull &&
    identityApproved &&
    offer.status !== 'cancelled' &&
    offer.status !== 'completed' &&
    offer.status !== 'expired' &&
    acceptedPolicy &&
    !reserve.isPending;

  const toggleSeat = (seat: number) => {
    setSelectedSeats((current) => {
      if (current.includes(seat)) {
        return current.filter((item) => item !== seat);
      }
      if (current.length >= effectiveSeats) {
        return current;
      }
      return [...current, seat];
    });
  };

  const handleReserve = async () => {
    setError(null);
    const idempotencyKey = idempotency.current ?? `${offerId}-${Date.now()}`;
    idempotency.current = idempotencyKey;
    try {
      const result = await reserve.mutateAsync({
        offerId: offer.id,
        seats: effectiveSeats,
        pickupSeq: pickupSeqValue,
        dropoffSeq: dropoffSeqValue,
        paymentMethod: payment,
        note: note.trim() || null,
        passengers:
          effectiveSeats > 1
            ? [
                { full_name: selfName },
                ...extraNameSlots.map((name) => ({ full_name: name.trim() })),
              ]
            : [],
        seatNumbers:
          effectiveSelectedSeats.length === effectiveSeats ? effectiveSelectedSeats : undefined,
        idempotencyKey,
      });
      router.replace(`/ride/trips/${result.reservation.id}` as never);
    } catch (cause) {
      setError(errorMessage(cause, 'Rezervasyon oluşturulamadı.'));
    }
  };

  const handleJoinWaitlist = async () => {
    setError(null);
    try {
      await joinWaitlist.mutateAsync({
        offerId: offer.id,
        seats: effectiveSeats,
        pickupSeq: pickupSeqValue,
        dropoffSeq: dropoffSeqValue,
      });
    } catch (cause) {
      setError(errorMessage(cause, 'Bekleme listesine katılamadın.'));
    }
  };

  const driverAvatar = mediaPublicUrl('avatar', offer.driver.avatar_path);
  const vehiclePhoto = rideVehiclePhotoUrl(offer.vehicle.photo_paths?.[0]);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title={`${offer.origin_city} → ${offer.dest_city}`}
        subtitle={`${formatDate(offer.depart_at)} · ${formatTime(offer.depart_at)}`}
        right={<StatusPill status={offer.status} />}
      />

      <View style={styles.viewMeta}>
        <ViewCount type="ride_offer" id={offer.id} initial={rideViewCount} showLabel />
      </View>

      <RideMapPreview
        origin={{ lat: offer.origin_lat, lng: offer.origin_lng }}
        dest={{ lat: offer.dest_lat, lng: offer.dest_lng }}
        distanceMeters={offer.distance_meters}
        height={190}
        label={`${offer.origin_label} → ${offer.dest_label}`}
      />

      <Card padding={14} style={styles.driverCard}>
        <View style={styles.driverRow}>
          <Avatar
            uri={driverAvatar}
            name={offer.driver.first_name ?? offer.driver.username}
            size={46}
          />
          <View style={styles.flex}>
            <View style={styles.nameRow}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {offer.driver.first_name ?? offer.driver.username}
              </AppText>
              {offer.driver.identity_verified ? <VerifiedTick size={15} /> : null}
              <LevelBadge level={offer.driver.level} />
            </View>
            <AppText variant="caption" color="textSecondary">
              {offer.driver.completed_trips ?? 0} tamamlanmış yolculuk
              {offer.driver.rating_avg ? ` · ${offer.driver.rating_avg.toFixed(1)} ★` : ''}
            </AppText>
            {offer.driver.identity_verified ? (
              <View style={styles.verifiedRow}>
                <VerifiedChip />
                <AppText variant="caption" color={VERIFIED_BLUE}>
                  · Yola çık
                </AppText>
              </View>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sürücüyle mesajlaş"
            onPress={() =>
              router.navigate({
                pathname: '/chat/new',
                params: { userId: offer.driver.id },
              } as never)
            }
            style={[styles.roundBtn, { backgroundColor: theme.colors.primarySoft }]}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={18}
              color={theme.colors.primaryDeep}
            />
          </Pressable>
        </View>
        {offer.driver.bio ? (
          <AppText variant="caption" color="textSecondary" numberOfLines={3}>
            {offer.driver.bio}
          </AppText>
        ) : null}
        <View style={styles.vehicleRow}>
          <View
            style={[
              styles.vehicleThumb,
              { borderColor: theme.colors.border, backgroundColor: theme.colors.primarySoft },
            ]}
          >
            {vehiclePhoto ? (
              <Image
                source={{ uri: vehiclePhoto }}
                style={styles.vehicleImage}
                contentFit="cover"
                transition={160}
              />
            ) : (
              <View style={styles.photoFallback}>
                <Ionicons name="car-sport" size={20} color={theme.colors.primaryDeep} />
              </View>
            )}
          </View>
          <View style={styles.flex}>
            <AppText variant="label">
              {offer.vehicle.make} {offer.vehicle.model} · {offer.vehicle.year}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {[
                offer.vehicle.color,
                offer.vehicle.fuel_type ? FUEL[offer.vehicle.fuel_type] : null,
                LUGGAGE[offer.luggage] ?? offer.luggage,
              ]
                .filter(Boolean)
                .join(' · ')}
            </AppText>
          </View>
          <Badge label={`${offer.availability.seats_total} koltuk`} tone="neutral" />
        </View>
      </Card>

      <View style={styles.block}>
        <RideSection
          title="Güzergâh"
          subtitle={`${offer.route_mode === 'fixed' ? 'Sabit güzergâh' : 'Esnek güzergâh'} · ${offer.stops.length} durak`}
        >
          <RouteTimeline
            stops={offer.stops}
            pickupSeq={pickupSeqValue}
            dropoffSeq={dropoffSeqValue}
            compact
          />
        </RideSection>
        <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Biniş noktası seç"
          onPress={() => setPickupOpen(true)}
          style={styles.selectRow}
        >
          <View style={[styles.selectDot, { backgroundColor: theme.colors.success }]} />
          <View style={styles.flex}>
            <AppText variant="caption" color="textTertiary">
              Biniş
            </AppText>
            <AppText variant="label" numberOfLines={1}>
              {pickupStop?.label ?? 'Seç'}
            </AppText>
          </View>
          <Ionicons name="chevron-down" size={16} color={theme.colors.textTertiary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="İniş noktası seç"
          onPress={() => setDropoffOpen(true)}
          style={styles.selectRow}
        >
          <View style={[styles.selectDot, { backgroundColor: theme.colors.primary }]} />
          <View style={styles.flex}>
            <AppText variant="caption" color="textTertiary">
              İniş
            </AppText>
            <AppText variant="label" numberOfLines={1}>
              {dropoffStop?.label ?? 'Seç'}
            </AppText>
          </View>
          <Ionicons name="chevron-down" size={16} color={theme.colors.textTertiary} />
        </Pressable>
        <AppText variant="caption" color="textTertiary">
          Bu bölümde {segmentAvailability} koltuk uygun. Koltuklar yalnızca seçtiğin bölüm için
          tutulur; başka bölümlerdeki boş koltuklar diğer yolculara açık kalır.
        </AppText>
      </View>

      <View style={styles.block}>
        <RideSection title="Tercihler" subtitle={offer.notes ?? undefined}>
          <PreferenceChips preferences={offer.preferences} />
        </RideSection>
        <View style={styles.metaGrid}>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={15} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textSecondary">
              {offer.duration_minutes
                ? formatDuration(offer.duration_minutes)
                : 'Süre hesaplanmadı'}
            </AppText>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="calendar-outline" size={15} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textSecondary">
              {offer.mode === 'instant' ? 'Anlık yolculuk' : 'Planlı yolculuk'}
            </AppText>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="hand-left-outline" size={15} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textSecondary">
              {offer.booking_mode === 'auto' ? 'Otomatik onay' : 'Sürücü onayı'}
            </AppText>
          </View>
        </View>
      </View>

      {isDriver ? (
        <View style={styles.block}>
          <RideSection
            title="İlan yönetimi"
            subtitle="Sürücü olarak bu ilanın rezervasyonlarını yönet."
          >
            <View style={styles.statsRow}>
              <View style={[styles.stat, { backgroundColor: theme.colors.surfaceMuted }]}>
                <AppText variant="h3">{occupancy}</AppText>
                <AppText variant="caption" color="textTertiary">
                  Dolu koltuk
                </AppText>
              </View>
              <View style={[styles.stat, { backgroundColor: theme.colors.surfaceMuted }]}>
                <AppText variant="h3">{reservations.data?.length ?? 0}</AppText>
                <AppText variant="caption" color="textTertiary">
                  Rezervasyon
                </AppText>
              </View>
              <View style={[styles.stat, { backgroundColor: theme.colors.surfaceMuted }]}>
                <AppText variant="h3">{formatMoney(total, offer.currency)}</AppText>
                <AppText variant="caption" color="textTertiary">
                  Bölüm bedeli
                </AppText>
              </View>
            </View>
            {(reservations.data ?? []).slice(0, 6).map((reservation) => (
              <Pressable
                key={reservation.id}
                onPress={() => router.navigate(`/ride/trips/${reservation.id}` as never)}
                style={[styles.reservationRow, { borderColor: theme.colors.border }]}
              >
                <Avatar
                  uri={mediaPublicUrl('avatar', reservation.passenger_avatar_path)}
                  name={reservation.passenger_first_name ?? reservation.passenger_username}
                  size={34}
                />
                <View style={styles.flex}>
                  <View style={styles.nameRow}>
                    <AppText variant="label" numberOfLines={1}>
                      {reservation.passenger_first_name ?? reservation.passenger_username}
                    </AppText>
                    {reservation.passenger_identity_verified ? <VerifiedTick size={13} /> : null}
                  </View>
                  <AppText variant="caption" color="textTertiary">
                    {reservation.seats} koltuk · {reservation.pickup_label} →{' '}
                    {reservation.dropoff_label}
                  </AppText>
                </View>
                <StatusPill status={reservation.status} />
              </Pressable>
            ))}
            <View style={styles.actionRow}>
              {offer.status === 'published' || offer.status === 'full' ? (
                <Button
                  label="Yolculuğu başlat"
                  leftIcon={<Ionicons name="play" size={16} color="#FFFFFF" />}
                  loading={startOffer.isPending}
                  onPress={() =>
                    startOffer.mutate(offer.id, {
                      onError: (cause) => setError(cause.message),
                    })
                  }
                  style={styles.flex}
                />
              ) : null}
              {offer.status === 'started' ? (
                <Button
                  label="Yolculuğu tamamla"
                  loading={completeOffer.isPending}
                  onPress={() =>
                    completeOffer.mutate(offer.id, {
                      onError: (cause) => setError(cause.message),
                    })
                  }
                  style={styles.flex}
                />
              ) : null}
              <Button
                label="İlanı iptal et"
                variant="outline"
                onPress={() =>
                  router.navigate({
                    pathname: '/ride/offers/manage',
                    params: { id: offer.id },
                  } as never)
                }
                style={styles.flex}
              />
            </View>
          </RideSection>
        </View>
      ) : myReservation ? (
        <View style={styles.block}>
          <RideSection title="Rezervasyonun" subtitle="Bu ilanda zaten bir rezervasyonun var.">
            <View style={styles.inlineRow}>
              <StatusPill status={myReservation.status ?? 'requested'} />
              <View style={styles.flex} />
              <Button
                label="Yolculuğa git"
                size="sm"
                variant="secondary"
                fullWidth={false}
                onPress={() => router.navigate(`/ride/trips/${myReservation.id}` as never)}
              />
            </View>
            {myReservation.status === 'requested' ||
            myReservation.status === 'awaiting_approval' ? (
              <Button
                label="Talebi iptal et"
                variant="outline"
                loading={cancel.isPending}
                onPress={() =>
                  cancel.mutate(
                    { reservationId: myReservation.id, reason: 'Yolcu talebi iptal etti' },
                    { onError: (cause) => setError(cause.message) },
                  )
                }
              />
            ) : null}
          </RideSection>
        </View>
      ) : (
        <View style={styles.block}>
          <RideSection
            title="Koltuk seç"
            subtitle={`En fazla ${Math.max(segmentAvailability, 1)} koltuk · seçmezsen sistem atar`}
          >
            <SeatMap
              availability={offer.availability}
              fromSeq={pickupSeqValue}
              toSeq={dropoffSeqValue}
              selected={effectiveSelectedSeats}
              onToggle={toggleSeat}
              maxSeats={Math.max(segmentAvailability, 1)}
            />
            <View style={styles.counterRow}>
              <AppText variant="body" color="textSecondary">
                Yolcu sayısı
              </AppText>
              <View style={styles.counter}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Yolcu sayısını azalt"
                  disabled={effectiveSeats <= 1}
                  onPress={() => setSeats((value) => Math.max(1, value - 1))}
                  style={[styles.stepBtn, { borderColor: theme.colors.border }]}
                >
                  <Ionicons name="remove" size={16} color={theme.colors.text} />
                </Pressable>
                <AppText variant="h3">{effectiveSeats}</AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Yolcu sayısını artır"
                  disabled={effectiveSeats >= Math.min(8, segmentAvailability)}
                  onPress={() => setSeats((value) => Math.min(8, segmentAvailability, value + 1))}
                  style={[styles.stepBtn, { borderColor: theme.colors.border }]}
                >
                  <Ionicons name="add" size={16} color={theme.colors.text} />
                </Pressable>
              </View>
            </View>
            {effectiveSeats > 1 ? (
              <View style={styles.group}>
                <AppText variant="label" color="textSecondary">
                  Grup yolcuları
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  İlk yolcu sensin. Diğer yolcuların adını gir; her kişi için ayrı koltuk ve
                  doğrulama kaydı oluşur.
                </AppText>
                {extraNameSlots.map((name, index) => (
                  <TextInput
                    key={index}
                    value={name}
                    onChangeText={(value) =>
                      setExtraNames((current) => {
                        const next = [...current];
                        while (next.length <= index) {
                          next.push('');
                        }
                        next[index] = value;
                        return next;
                      })
                    }
                    placeholder={`${index + 2}. yolcu adı soyadı`}
                    placeholderTextColor={theme.colors.textTertiary}
                    style={[
                      styles.input,
                      {
                        color: theme.colors.text,
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.inputBackground,
                      },
                    ]}
                  />
                ))}
              </View>
            ) : null}
          </RideSection>
        </View>
      )}

      {!isDriver ? (
        <View style={styles.block}>
          <RideSection title="Yolculuk koşulları" subtitle={`Sürüm ${offer.policy_version}`}>
            {offer.policy.items.map((item) => (
              <View key={item} style={styles.policyRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={14}
                  color={theme.colors.success}
                  style={styles.policyIcon}
                />
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  {item}
                </AppText>
              </View>
            ))}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptedPolicy }}
              onPress={() => setAcceptedPolicy((value) => !value)}
              style={styles.checkRow}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: acceptedPolicy ? theme.colors.primary : theme.colors.borderStrong,
                    backgroundColor: acceptedPolicy ? theme.colors.primary : 'transparent',
                  },
                ]}
              >
                {acceptedPolicy ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
              </View>
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Yolculuk koşullarını, iptal ve iade kurallarını okudum; rezervasyon sırasında koşul
                sürümü ve kabul zamanım kaydedilecek.
              </AppText>
            </Pressable>
          </RideSection>
        </View>
      ) : null}

      {!isDriver ? (
        <View style={styles.block}>
          <RideSection title="Ödeme" subtitle="Kart verisi uygulama veritabanında saklanmaz.">
            <View style={styles.payRow}>
              {(['cash', 'card'] as const).map((method) => {
                const disabled = method === 'card' && !cardEnabled;
                const active = payment === method;
                return (
                  <Pressable
                    key={method}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, disabled }}
                    disabled={disabled}
                    onPress={() => setPayment(method)}
                    style={[
                      styles.payOption,
                      {
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                        backgroundColor: active
                          ? theme.colors.primarySoft
                          : theme.colors.surfaceMuted,
                        opacity: disabled ? 0.55 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={method === 'cash' ? 'cash-outline' : 'card-outline'}
                      size={18}
                      color={active ? theme.colors.primaryDeep : theme.colors.textSecondary}
                    />
                    <View style={styles.flex}>
                      <AppText variant="label">
                        {method === 'cash' ? 'Yolculukta ödeme' : 'Kartla ödeme'}
                      </AppText>
                      <AppText variant="caption" color="textTertiary">
                        {method === 'cash'
                          ? 'Sürücüye yolculuk sırasında öde'
                          : cardEnabled
                            ? 'Güvenli sağlayıcı üzerinden'
                            : 'Ödeme sağlayıcısı yetkisi tamamlanmadan kapalı'}
                      </AppText>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Sürücüye not (isteğe bağlı)"
              placeholderTextColor={theme.colors.textTertiary}
              multiline
              style={[
                styles.input,
                styles.noteInput,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.inputBackground,
                },
              ]}
            />
            <View style={styles.totalRow}>
              <View>
                <AppText variant="caption" color="textTertiary">
                  {effectiveSeats} koltuk ×{' '}
                  {formatMoney(offer.price_per_seat_cents, offer.currency)}
                </AppText>
                <AppText variant="h2">{formatMoney(total, offer.currency)}</AppText>
              </View>
              <Badge label={payment === 'cash' ? 'Yolculukta ödeme' : 'Kartla'} tone="primary" />
            </View>
            {error ? (
              <AppText variant="caption" color="danger">
                {error}
              </AppText>
            ) : null}
            {isFull ? (
              offer.waitlist ? (
                <View style={styles.stack}>
                  <AppText variant="caption" color="textSecondary">
                    Bekleme listesindesin
                    {offer.waitlist.status === 'offered'
                      ? ' · koltuk teklifi hazır'
                      : ` · sıra ${offer.waitlist.position}`}
                    .
                  </AppText>
                  {waitlistOffer ? (
                    <Button
                      label="Koltuk teklifini kabul et"
                      loading={acceptWaitlist.isPending}
                      onPress={() => {
                        if (!waitlistOffer) {
                          return;
                        }
                        acceptWaitlist.mutate(waitlistOffer.id, {
                          onSuccess: (result) => {
                            if (result.reservation) {
                              router.replace(`/ride/trips/${result.reservation.id}` as never);
                            }
                          },
                          onError: (cause) => setError(cause.message),
                        });
                      }}
                    />
                  ) : (
                    <Button
                      label="Bekleme listesinden çık"
                      variant="outline"
                      loading={leaveWaitlist.isPending}
                      onPress={() =>
                        leaveWaitlist.mutate(offer.id, {
                          onError: (cause) => setError(cause.message),
                        })
                      }
                    />
                  )}
                </View>
              ) : (
                <Button
                  label="Bekleme listesine katıl"
                  loading={joinWaitlist.isPending}
                  onPress={() => void handleJoinWaitlist()}
                />
              )
            ) : (
              <Button
                label={
                  !identityApproved
                    ? 'Kimlik doğrulaması gerekli'
                    : offer.booking_mode === 'auto'
                      ? `Rezervasyonu tamamla · ${formatMoney(total, offer.currency)}`
                      : `Talep gönder · ${formatMoney(total, offer.currency)}`
                }
                loading={reserve.isPending}
                disabled={!canReserve}
                onPress={() => void handleReserve()}
              />
            )}
            {!identityApproved ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.navigate('/ride/verification' as never)}
                style={[styles.warningBox, { backgroundColor: theme.colors.warningSoft }]}
              >
                <Ionicons name="shield-outline" size={16} color={theme.colors.warning} />
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  Rezervasyon için kimlik doğrulaması zorunlu. Doğrulaman onaylanmadan talep
                  gönderemezsin.
                </AppText>
                <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
              </Pressable>
            ) : null}
          </RideSection>
        </View>
      ) : null}

      <SelectSheet
        visible={pickupOpen}
        title="Biniş noktası"
        options={pickupOptions}
        value={pickupStop ? `${pickupStop.seq}|${pickupStop.label}` : null}
        onClose={() => setPickupOpen(false)}
        onSelect={(value) => {
          const seq = Number(value.split('|')[0]);
          setPickupSeq(seq);
          if (dropoffSeqValue <= seq) {
            setDropoffSeq(maxSeq > seq ? maxSeq : null);
          }
          setSelectedSeats([]);
          setPickupOpen(false);
        }}
      />
      <SelectSheet
        visible={dropoffOpen}
        title="İniş noktası"
        options={dropoffOptions}
        value={dropoffStop ? `${dropoffStop.seq}|${dropoffStop.label}` : null}
        onClose={() => setDropoffOpen(false)}
        onSelect={(value) => {
          setDropoffSeq(Number(value.split('|')[0]));
          setSelectedSeats([]);
          setDropoffOpen(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  viewMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  stack: { gap: 8 },
  center: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  driverCard: { gap: 10 },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 },
  roundBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  vehicleThumb: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  vehicleImage: { width: '100%', height: '100%' },
  photoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  block: { gap: 12 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 4 },
  selectDot: { width: 8, height: 8, borderRadius: 4 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statsRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderRadius: 12, padding: 10, gap: 2 },
  reservationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  group: { gap: 7 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  noteInput: { minHeight: 62, textAlignVertical: 'top' },
  policyRow: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  policyIcon: { marginTop: 1 },
  checkRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', paddingTop: 2 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  payRow: { flexDirection: 'row', gap: 8 },
  payOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 13,
    borderWidth: 1,
    padding: 11,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
});
