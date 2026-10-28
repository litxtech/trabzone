import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText, Avatar, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { env } from '@/config/env';
import { shareRideSummary } from '@/features/documents';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';

import { RideEmptyState, RideSection, StatusPill } from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import { RideMapPreview } from '@/features/ride/components/RideMapPreview';
import { RouteTimeline } from '@/features/ride/components/RouteTimeline';
import {
  useAlightPassenger,
  useBoardPassenger,
  useCancelReservation,
  useCompleteOffer,
  useCreateLocationShare,
  useOpenDispute,
  useRespondReservation,
  useRideOffer,
  useSendSos,
  useStartOffer,
  useSubmitReview,
  useTrackPosition,
  useTracking,
  useTripDetail,
} from '@/features/ride/hooks/use-ride';
import {
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatMoney,
  formatTime,
  RESERVATION_STATUS_LABEL,
  SCOPE_LABEL,
} from '@/features/ride/utils/format';
import { NEEDS_DEV_BUILD, loadLocation } from '@/features/ride/utils/native';

type DisputeCategory =
  'no_show' | 'late' | 'route_change' | 'safety' | 'payment' | 'vehicle' | 'other';

const DISPUTE_LABEL: Record<DisputeCategory, string> = {
  no_show: 'Gelmedi',
  late: 'Gecikme',
  route_change: 'Rota değişikliği',
  safety: 'Güvenlik',
  payment: 'Ödeme',
  vehicle: 'Araç',
  other: 'Diğer',
};

export default function RideTripDetailScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const reservationId = String(params.id ?? '');

  const trip = useTripDetail(reservationId || null);
  const offer = useRideOffer(trip.data?.reservation.offer_id ?? null);
  const tracking = useTracking(
    trip.data?.reservation.offer_id ?? null,
    trip.data?.reservation.offer_status === 'started',
  );

  const respond = useRespondReservation();
  const cancel = useCancelReservation();
  const board = useBoardPassenger();
  const alight = useAlightPassenger();
  const startOffer = useStartOffer();
  const completeOffer = useCompleteOffer();
  const track = useTrackPosition();
  const share = useCreateLocationShare();
  const sos = useSendSos();
  const review = useSubmitReview();
  const dispute = useOpenDispute();

  const [boardCode, setBoardCode] = useState('');
  const [alightCode, setAlightCode] = useState('');
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeCategory, setDisputeCategory] = useState<DisputeCategory>('other');
  const [disputeText, setDisputeText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (!broadcasting || !trip.data?.reservation.id) {
      return;
    }
    let subscription: { remove: () => void } | null = null;
    let cancelled = false;

    const start = async () => {
      const Location = await loadLocation();
      if (!Location) {
        setBroadcasting(false);
        setError(NEEDS_DEV_BUILD);
        return;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setBroadcasting(false);
        setError('Canlı konum paylaşımı için konum izni gerekli.');
        return;
      }
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 30_000,
          distanceInterval: 60,
        },
        (position) => {
          if (cancelled) {
            return;
          }
          track.mutate({
            offerId: trip.data?.reservation.offer_id ?? '',
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            heading: position.coords.heading,
            speedKmh:
              position.coords.speed != null && position.coords.speed >= 0
                ? position.coords.speed * 3.6
                : null,
          });
        },
      );
    };
    void start();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcasting, trip.data?.reservation.id, trip.data?.reservation.offer_id]);

  if (trip.isLoading) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']} padded>
        <RideHeader title="Yolculuk" />
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
          <AppText variant="caption" color="textTertiary">
            Yolculuk yükleniyor…
          </AppText>
        </View>
      </Screen>
    );
  }

  if (trip.isError || !trip.data) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']} padded>
        <RideHeader title="Yolculuk" />
        <RideEmptyState
          icon="alert-circle-outline"
          title="Yolculuk açılamadı"
          message={trip.error?.message ?? 'Bu rezervasyona erişim yetkin yok.'}
          action={
            <Button
              label="Yolculuklarıma dön"
              variant="secondary"
              onPress={() => router.replace('/ride/trips' as never)}
            />
          }
        />
      </Screen>
    );
  }

  const { reservation, is_driver: isDriver } = trip.data;
  const offerData = offer.data;
  const started = reservation.offer_status === 'started';
  const completed = reservation.status === 'completed';
  const cancelled = ['cancelled', 'rejected', 'expired'].includes(reservation.status);
  const pending = ['requested', 'awaiting_approval'].includes(reservation.status);
  const driverAvatar = mediaPublicUrl('avatar', reservation.driver_avatar_path);
  const passengerAvatar = mediaPublicUrl('avatar', reservation.passenger_avatar_path);
  const partnerName = isDriver
    ? (reservation.passenger_first_name ?? reservation.passenger_username)
    : (reservation.driver_first_name ?? reservation.driver_username);
  const partnerAvatar = isDriver ? passengerAvatar : driverAvatar;
  const partnerId = isDriver ? reservation.passenger_id : reservation.driver_id;
  const trackingPoint =
    tracking.data?.lat != null && tracking.data?.lng != null
      ? { lat: tracking.data.lat, lng: tracking.data.lng }
      : null;

  const handleSos = () => {
    Alert.alert(
      'Acil durum',
      'Trabzone resmi acil yardım hizmeti değildir. 112 aranacak ve güvenilir kişilerine konum bildirimi gönderilecek.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: '112 ara ve bildir',
          style: 'destructive',
          onPress: () => {
            sos.mutate(
              {
                reservationId: reservation.id,
                lat: trackingPoint?.lat ?? null,
                lng: trackingPoint?.lng ?? null,
                note: 'Yolculuk sırasında SOS tetiklendi',
              },
              {
                onSuccess: (result) => {
                  setNotice(result.disclaimer);
                  void Linking.openURL('tel:112');
                },
                onError: (cause) => setError(cause.message),
              },
            );
          },
        },
      ],
    );
  };

  const handleShare = () => {
    share.mutate(
      { reservationId: reservation.id, minutes: 120 },
      {
        onSuccess: async (result) => {
          const link = `${env.appUrl}/ride/share/${result.token}`;
          await Clipboard.setStringAsync(link);
          setShareLink(link);
          setNotice('Süreli konum bağlantısı kopyalandı. 2 saat sonra otomatik kapanır.');
        },
        onError: (cause) => setError(cause.message),
      },
    );
  };

  const exportSummary = async () => {
    const data = trip.data;
    if (!data) return;
    setPdfBusy(true);
    try {
      const result = await shareRideSummary({
        reservation: data.reservation,
        isDriver: data.is_driver,
        distanceMeters: offerData?.distance_meters ?? null,
        durationMinutes: offerData?.duration_minutes ?? null,
      });
      if (!result.ok) {
        Alert.alert('PDF oluşturulamadı', result.error.message);
      }
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title={`${reservation.origin_city} → ${reservation.dest_city}`}
        subtitle={`${formatDate(reservation.depart_at)} · ${formatTime(reservation.depart_at)}`}
        right={
          <View style={styles.headerActions}>
            <StatusPill status={reservation.status} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Yolculuk özetini PDF olarak paylaş"
              onPress={() => void exportSummary()}
              style={[
                styles.pdfBtn,
                { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border },
              ]}
            >
              <Ionicons
                name={pdfBusy ? 'hourglass-outline' : 'download-outline'}
                size={17}
                color={theme.colors.primaryDeep}
              />
            </Pressable>
          </View>
        }
      />

      {started && offerData ? (
        <RideMapPreview
          origin={trackingPoint ?? { lat: offerData.origin_lat, lng: offerData.origin_lng }}
          dest={{ lat: offerData.dest_lat, lng: offerData.dest_lng }}
          geometry={
            trackingPoint
              ? [trackingPoint, { lat: offerData.dest_lat, lng: offerData.dest_lng }]
              : undefined
          }
          distanceMeters={tracking.data?.remaining_meters ?? offerData.distance_meters}
          height={210}
          label={
            tracking.data?.eta_minutes != null
              ? `Tahmini varış ${tracking.data.eta_minutes} dk`
              : 'Canlı yolculuk'
          }
        />
      ) : offerData ? (
        <RideMapPreview
          origin={{ lat: offerData.origin_lat, lng: offerData.origin_lng }}
          dest={{ lat: offerData.dest_lat, lng: offerData.dest_lng }}
          distanceMeters={offerData.distance_meters}
          height={180}
          label={`${reservation.origin_label} → ${reservation.dest_label}`}
        />
      ) : null}

      <Card padding={15} style={styles.summary}>
        <View style={styles.partnerRow}>
          <Avatar uri={partnerAvatar} name={partnerName} size={46} />
          <View style={styles.flex}>
            <View style={styles.nameRow}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {partnerName}
              </AppText>
              <Badge label={isDriver ? 'Yolcu' : 'Sürücü'} tone="neutral" />
            </View>
            <AppText variant="caption" color="textSecondary">
              {isDriver
                ? `${reservation.seats} koltuk · ${reservation.passenger_username}`
                : `${reservation.driver_trips ?? 0} yolculuk · ${reservation.driver_rating?.toFixed(1) ?? '—'} ★`}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mesaj gönder"
            onPress={() =>
              router.navigate({ pathname: '/chat/new', params: { userId: partnerId } } as never)
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

        <View style={styles.grid}>
          <View style={styles.gridItem}>
            <AppText variant="caption" color="textTertiary">
              Araç
            </AppText>
            <AppText variant="label" numberOfLines={1}>
              {reservation.vehicle.make} {reservation.vehicle.model}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              {reservation.vehicle.plate}
            </AppText>
          </View>
          <View style={styles.gridItem}>
            <AppText variant="caption" color="textTertiary">
              Biniş
            </AppText>
            <AppText variant="label" numberOfLines={2}>
              {reservation.pickup_label}
            </AppText>
          </View>
          <View style={styles.gridItem}>
            <AppText variant="caption" color="textTertiary">
              İniş
            </AppText>
            <AppText variant="label" numberOfLines={2}>
              {reservation.dropoff_label}
            </AppText>
          </View>
          <View style={styles.gridItem}>
            <AppText variant="caption" color="textTertiary">
              Toplam
            </AppText>
            <AppText variant="label">
              {formatMoney(reservation.total_cents, reservation.currency)}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              {reservation.payment_method === 'cash' ? 'Yolculukta ödeme' : 'Kartla ödeme'}
            </AppText>
          </View>
        </View>

        <View style={styles.badgeRow}>
          <Badge label={SCOPE_LABEL[reservation.scope]} tone="neutral" />
          <Badge label={`${reservation.seats} koltuk`} tone="primary" />
          <Badge
            label={reservation.payment_status === 'paid' ? 'Ödendi' : 'Ödeme bekliyor'}
            tone={reservation.payment_status === 'paid' ? 'success' : 'warning'}
          />
          {reservation.seats_detail.length ? (
            <Badge
              label={`Koltuk ${reservation.seats_detail.map((seat) => seat.seat_no).join(', ')}`}
              tone="neutral"
            />
          ) : null}
        </View>
        {reservation.note ? (
          <AppText variant="caption" color="textSecondary">
            Not: {reservation.note}
          </AppText>
        ) : null}
      </Card>

      {!cancelled && !completed ? (
        <Card padding={15} style={styles.codeCard}>
          <RideSection
            title={isDriver ? 'Biniş ve iniş doğrulama' : 'Doğrulama kodların'}
            subtitle={
              isDriver
                ? 'Yolcunun söylediği kodu gir; kod sunucuda doğrulanır.'
                : 'Kodu yalnızca sürücüye söyle. Kod sunucuda doğrulanmadan biniş sayılmaz.'
            }
          >
            {isDriver ? (
              <View style={styles.stack}>
                <View style={styles.codeInputRow}>
                  <TextInput
                    value={boardCode}
                    onChangeText={setBoardCode}
                    placeholder="Biniş kodu"
                    autoCapitalize="characters"
                    maxLength={8}
                    placeholderTextColor={theme.colors.textTertiary}
                    style={[
                      styles.input,
                      styles.flex,
                      {
                        color: theme.colors.text,
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.inputBackground,
                      },
                    ]}
                  />
                  <Button
                    label="Binişi onayla"
                    size="sm"
                    fullWidth={false}
                    loading={board.isPending}
                    disabled={!boardCode.trim() || reservation.boarded_at != null}
                    onPress={() =>
                      board.mutate(
                        { reservationId: reservation.id, code: boardCode.trim() },
                        {
                          onSuccess: () => setNotice('Biniş doğrulandı.'),
                          onError: (cause) => setError(cause.message),
                        },
                      )
                    }
                  />
                </View>
                <View style={styles.codeInputRow}>
                  <TextInput
                    value={alightCode}
                    onChangeText={setAlightCode}
                    placeholder="İniş kodu"
                    autoCapitalize="characters"
                    maxLength={8}
                    placeholderTextColor={theme.colors.textTertiary}
                    style={[
                      styles.input,
                      styles.flex,
                      {
                        color: theme.colors.text,
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.inputBackground,
                      },
                    ]}
                  />
                  <Button
                    label="İnişi onayla"
                    size="sm"
                    variant="secondary"
                    fullWidth={false}
                    loading={alight.isPending}
                    disabled={
                      !alightCode.trim() ||
                      reservation.boarded_at == null ||
                      reservation.alighted_at != null
                    }
                    onPress={() =>
                      alight.mutate(
                        { reservationId: reservation.id, code: alightCode.trim() },
                        {
                          onSuccess: () => {
                            setNotice('İniş doğrulandı. Koltuk sonraki bölüm için açıldı.');
                            setAlightCode('');
                          },
                          onError: (cause) => setError(cause.message),
                        },
                      )
                    }
                  />
                </View>
              </View>
            ) : (
              <View style={styles.stack}>
                <View
                  style={[
                    styles.codeBox,
                    {
                      backgroundColor: theme.colors.surfaceMuted,
                      borderColor: theme.colors.border,
                    },
                  ]}
                >
                  <AppText variant="caption" color="textTertiary">
                    Biniş kodu
                  </AppText>
                  <AppText variant="h1" style={styles.codeText}>
                    {reservation.boarding_code ?? '—'}
                  </AppText>
                  <AppText variant="caption" color="textSecondary">
                    {reservation.boarded_at ? 'Biniş doğrulandı' : 'Sürücüye bu kodu göster'}
                  </AppText>
                </View>
                <View
                  style={[
                    styles.codeBox,
                    { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border },
                  ]}
                >
                  <AppText variant="caption" color="textTertiary">
                    İniş kodu
                  </AppText>
                  <AppText variant="h1" style={styles.codeText}>
                    {reservation.alighting_code ?? '—'}
                  </AppText>
                  <AppText variant="caption" color="textSecondary">
                    {reservation.alighted_at ? 'İniş doğrulandı' : 'İneceğin zaman sürücüye söyle'}
                  </AppText>
                </View>
              </View>
            )}
          </RideSection>
        </Card>
      ) : null}

      {isDriver && pending ? (
        <Card padding={15}>
          <RideSection
            title="Rezervasyon talebi"
            subtitle={`${reservation.passenger_first_name ?? reservation.passenger_username} · ${reservation.seats} koltuk`}
          >
            <View style={styles.actionRow}>
              <Button
                label="Onayla"
                loading={respond.isPending}
                onPress={() =>
                  respond.mutate(
                    { reservationId: reservation.id, approve: true },
                    { onError: (cause) => setError(cause.message) },
                  )
                }
                style={styles.flex}
              />
              <Button
                label="Reddet"
                variant="danger"
                onPress={() =>
                  respond.mutate(
                    {
                      reservationId: reservation.id,
                      approve: false,
                      reason: 'Sürücü uygun bulmadı',
                    },
                    { onError: (cause) => setError(cause.message) },
                  )
                }
                style={styles.flex}
              />
            </View>
          </RideSection>
        </Card>
      ) : null}

      {isDriver ? (
        <Card padding={15}>
          <RideSection
            bare
            title="Yolculuk kontrolü"
            subtitle="Yolculuk yalnızca kalkışa 30 dakika kala başlatılabilir."
          >
            <View style={styles.actionRow}>
              {reservation.offer_status === 'published' || reservation.offer_status === 'full' ? (
                <Button
                  label="Yolculuğu başlat"
                  loading={startOffer.isPending}
                  onPress={() =>
                    startOffer.mutate(reservation.offer_id, {
                      onSuccess: () => setBroadcasting(true),
                      onError: (cause) => setError(cause.message),
                    })
                  }
                  style={styles.flex}
                />
              ) : null}
              {reservation.offer_status === 'started' ? (
                <Button
                  label="Yolculuğu tamamla"
                  loading={completeOffer.isPending}
                  onPress={() =>
                    completeOffer.mutate(reservation.offer_id, {
                      onSuccess: () => setBroadcasting(false),
                      onError: (cause) => setError(cause.message),
                    })
                  }
                  style={styles.flex}
                />
              ) : null}
              <Button
                label={broadcasting ? 'Konum paylaşımını durdur' : 'Canlı konumu paylaş'}
                variant="secondary"
                onPress={() => setBroadcasting((value) => !value)}
                style={styles.flex}
              />
            </View>
            {broadcasting ? (
              <View style={[styles.liveBox, { backgroundColor: theme.colors.successSoft }]}>
                <Ionicons name="radio" size={16} color={theme.colors.success} />
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  Konum 30 saniyede bir sunucuya gönderiliyor. Rota sapması algılanırsa güvenlik
                  kaydı oluşur ve yolculara bildirim gider.
                </AppText>
              </View>
            ) : null}
          </RideSection>
        </Card>
      ) : null}

      {!isDriver && !cancelled && !completed ? (
        <Card padding={15}>
          <RideSection
            bare
            title="İptal"
            subtitle="Son dakika iptalinde iade kuralları rezervasyon anındaki koşullara göre uygulanır."
          >
            <Button
              label="Rezervasyonu iptal et"
              variant="outline"
              loading={cancel.isPending}
              onPress={() =>
                Alert.alert(
                  'Rezervasyon iptal edilsin mi?',
                  'Koltuk serbest bırakılır ve iade kuralı ödeme yöntemine göre uygulanır.',
                  [
                    { text: 'Vazgeç', style: 'cancel' },
                    {
                      text: 'İptal et',
                      style: 'destructive',
                      onPress: () =>
                        cancel.mutate(
                          {
                            reservationId: reservation.id,
                            reason: 'Yolcu rezervasyonu iptal etti',
                          },
                          { onError: (cause) => setError(cause.message) },
                        ),
                    },
                  ],
                )
              }
            />
          </RideSection>
        </Card>
      ) : null}

      {started || completed ? (
        <Card padding={15}>
          <RideSection
            title="Güvenlik merkezi"
            subtitle="Trabzone resmi acil yardım hizmeti değildir. Acil durumda 112'yi ara."
          >
            <View style={styles.actionRow}>
              <Button
                label="SOS"
                variant="danger"
                leftIcon={<Ionicons name="warning" size={16} color="#FFFFFF" />}
                loading={sos.isPending}
                onPress={handleSos}
                style={styles.flex}
              />
              <Button
                label="Güvenilir kişilerle paylaş"
                variant="secondary"
                loading={share.isPending}
                onPress={handleShare}
                style={styles.flex}
              />
            </View>
            {shareLink ? (
              <Pressable onPress={() => void Clipboard.setStringAsync(shareLink)}>
                <AppText variant="caption" color="primaryDeep" numberOfLines={1}>
                  {shareLink}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  Bağlantıyı kopyalamak için dokun.
                </AppText>
              </Pressable>
            ) : null}
            <View style={styles.actionRow}>
              <Button
                label="Güvenlik olayı bildir"
                variant="ghost"
                onPress={() => router.navigate('/ride/safety' as never)}
                style={styles.flex}
              />
              <Button
                label="Uyuşmazlık aç"
                variant="ghost"
                onPress={() => setDisputeOpen((value) => !value)}
                style={styles.flex}
              />
            </View>
            {disputeOpen ? (
              <View style={styles.stack}>
                <View style={styles.chips}>
                  {(Object.keys(DISPUTE_LABEL) as DisputeCategory[]).map((item) => {
                    const active = disputeCategory === item;
                    return (
                      <Pressable
                        key={item}
                        onPress={() => setDisputeCategory(item)}
                        style={[
                          styles.chip,
                          {
                            borderColor: active ? theme.colors.primary : theme.colors.border,
                            backgroundColor: active
                              ? theme.colors.primarySoft
                              : theme.colors.surfaceMuted,
                          },
                        ]}
                      >
                        <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                          {DISPUTE_LABEL[item]}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  value={disputeText}
                  onChangeText={setDisputeText}
                  placeholder="Olayı ve talebini yaz"
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
                <Button
                  label="Uyuşmazlığı gönder"
                  loading={dispute.isPending}
                  disabled={!disputeText.trim()}
                  onPress={() =>
                    dispute.mutate(
                      {
                        reservationId: reservation.id,
                        category: disputeCategory,
                        description: disputeText.trim(),
                      },
                      {
                        onSuccess: () => {
                          setNotice('Uyuşmazlık moderasyon kuyruğuna alındı.');
                          setDisputeOpen(false);
                          setDisputeText('');
                        },
                        onError: (cause) => setError(cause.message),
                      },
                    )
                  }
                />
              </View>
            ) : null}
          </RideSection>
        </Card>
      ) : null}

      {completed && !reservation.has_reviewed ? (
        <Card padding={15}>
          <RideSection
            title={isDriver ? 'Yolcunu değerlendir' : 'Sürücünü değerlendir'}
            subtitle="Yalnızca gerçekleşmiş yolculuklar değerlendirilebilir."
          >
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`${value} yıldız`}
                  onPress={() => setRating(value)}
                >
                  <Ionicons
                    name={value <= rating ? 'star' : 'star-outline'}
                    size={28}
                    color={value <= rating ? theme.colors.warning : theme.colors.textTertiary}
                  />
                </Pressable>
              ))}
            </View>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Deneyimini paylaş (isteğe bağlı)"
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
            <Button
              label="Değerlendirmeyi gönder"
              loading={review.isPending}
              onPress={() =>
                review.mutate(
                  {
                    reservationId: reservation.id,
                    rating,
                    comment: comment.trim() || null,
                  },
                  {
                    onSuccess: () => setNotice('Değerlendirmen kaydedildi.'),
                    onError: (cause) => setError(cause.message),
                  },
                )
              }
            />
          </RideSection>
        </Card>
      ) : null}

      {completed ? (
        <Card padding={15} tone="muted">
          <AppText variant="body" color="textSecondary">
            Yolculuk tamamlandı. Dijital özeti PDF olarak indirebilir veya arşivdeki hesap
            özetini açabilirsin.
          </AppText>
          <View style={styles.actionRow}>
            <Button
              label={pdfBusy ? 'Hazırlanıyor…' : 'PDF özeti'}
              variant="primary"
              loading={pdfBusy}
              onPress={() => void exportSummary()}
              style={styles.flex}
            />
            <Button
              label="Arşiv ve makbuzlar"
              variant="secondary"
              onPress={() => router.navigate('/ride/archive' as never)}
              style={styles.flex}
            />
          </View>
        </Card>
      ) : null}

      {offerData && offerData.stops.length > 1 ? (
        <Card padding={15}>
          <RideSection bare title="Güzergâh" subtitle="Koltuklar her bölüm için ayrı hesaplanır.">
            <RouteTimeline
              stops={offerData.stops}
              pickupSeq={reservation.pickup_seq}
              dropoffSeq={reservation.dropoff_seq}
              compact
            />
          </RideSection>
        </Card>
      ) : null}

      {notice ? (
        <Card padding={12} tone="primarySoft">
          <AppText variant="caption" color="textSecondary">
            {notice}
          </AppText>
        </Card>
      ) : null}
      {error ? (
        <Card padding={12} tone="muted">
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        </Card>
      ) : null}

      <Card padding={15} tone="muted">
        <RideSection
          bare
          title="Yolculuk koşulları"
          subtitle={`Sürüm ${reservation.policy_version}`}
        >
          <AppText variant="caption" color="textSecondary">
            Rezervasyon sırasında kabul ettiğin koşullar bu sürümle kaydedildi. İptal, iade ve
            güvenlik kuralları bu sürüme göre uygulanır.
          </AppText>
          <Button
            label="Koşulları görüntüle"
            variant="ghost"
            size="sm"
            onPress={() => router.navigate('/ride/policy' as never)}
          />
        </RideSection>
      </Card>

      <AppText variant="caption" color="textTertiary" align="center">
        {RESERVATION_STATUS_LABEL[reservation.status]} ·{' '}
        {reservation.hold_expires_at
          ? `Koltuk tutma süresi ${formatDateTime(reservation.hold_expires_at)}`
          : `Son güncelleme ${formatDateTime(new Date().toISOString())}`}
        {offerData?.duration_minutes ? ` · ${formatDuration(offerData.duration_minutes)}` : ''}
        {offerData?.distance_meters ? ` · ${formatDistance(offerData.distance_meters)}` : ''}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: 9 },
  center: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  summary: { gap: 12 },
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  pdfBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridItem: { flexBasis: '46%', gap: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  codeCard: { gap: 10 },
  codeBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 15,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 2,
  },
  codeText: { letterSpacing: 6, fontVariant: ['tabular-nums'] },
  codeInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  noteInput: { minHeight: 76, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  liveBox: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 11, padding: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stars: { flexDirection: 'row', gap: 8, alignSelf: 'center' },
});
