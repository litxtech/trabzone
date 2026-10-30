import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppImage, AppText, Button, Screen, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import {
  EmptyState,
  InfoBanner,
  InlineError,
  KeyValueRow,
  LoadingBlock,
  ModalSheet,
  MoneyText,
  StarRating,
} from '@/features/accommodation/components/AccommodationUI';
import {
  AURORA,
  AuroraBackdrop,
  GlassPill,
  IconSquare,
  SegmentedTabs,
} from '@/features/accommodation/components/PremiumUI';
import {
  useCancelMyReservation,
  useCreateReview,
  useMyReservation,
  useMyReservations,
} from '@/features/accommodation/hooks/use-accommodation';
import { useAccommodationLayout } from '@/features/accommodation/hooks/use-accommodation-layout';
import { accommodationMediaUrl } from '@/features/accommodation/services/accommodation-media-service';
import type { MyReservation, ReservationStatus } from '@/features/accommodation/types';
import {
  BOOKING_MODE_LABELS,
  formatDate,
  formatDateTime,
  formatMoneyCents,
  guestCount,
  paymentStatusLabel,
  paymentTone,
  reservationTone,
} from '@/features/accommodation/utils/format';

type Tab = 'upcoming' | 'past' | 'cancelled';

const UPCOMING: ReservationStatus[] = [
  'draft',
  'pending',
  'confirmed',
  'awaiting_checkin',
  'change_pending',
  'checked_in',
  'staying',
];
const PAST: ReservationStatus[] = ['checked_out', 'completed', 'no_show'];
const CANCELLED: ReservationStatus[] = ['cancelled', 'declined', 'expired', 'disputed'];

export default function MyReservationsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const layout = useAccommodationLayout();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reservations = useMyReservations();
  const items = useMemo(() => reservations.data ?? [], [reservations.data]);

  const filtered = useMemo(() => {
    const statuses = tab === 'upcoming' ? UPCOMING : tab === 'past' ? PAST : CANCELLED;
    return items.filter((item) => statuses.includes(item.status));
  }, [items, tab]);

  const counts = useMemo(
    () => ({
      upcoming: items.filter((item) => UPCOMING.includes(item.status)).length,
      past: items.filter((item) => PAST.includes(item.status)).length,
      cancelled: items.filter((item) => CANCELLED.includes(item.status)).length,
    }),
    [items],
  );

  const stats = useMemo(() => {
    const active = items.filter((item) => UPCOMING.includes(item.status));
    const nights = active.reduce((total, item) => total + item.nights, 0);
    const pending = items.filter((item) => item.status === 'pending').length;
    const spend = items
      .filter((item) => !CANCELLED.includes(item.status))
      .reduce((total, item) => total + item.total_cents, 0);
    return { nights, pending, spend };
  }, [items]);

  return (
    <Screen
      scroll
      padded={false}
      edges={['top', 'left', 'right']}
      refreshControl={
        <RefreshControl
          refreshing={reservations.isRefetching && !reservations.isLoading}
          onRefresh={() => void reservations.refetch()}
          tintColor={theme.colors.primary}
        />
      }
    >
      <AuroraBackdrop style={styles.hero} colors={[AURORA.night, '#101A33', '#312A6B']}>
        <View style={styles.heroTop}>
          <IconSquare icon="chevron-back" accessibilityLabel="Geri" onPress={() => router.back()} />
          <View style={styles.heroBrand}>
            <AppText variant="overline" style={styles.brandOverline}>
              TRABZONE KONAKLAMA
            </AppText>
            <AppText variant="h3" style={styles.brandTitle}>
              Rezervasyonlarım
            </AppText>
          </View>
          <IconSquare icon="search" accessibilityLabel="Tesisleri keşfet" onPress={() => router.push('/konaklama' as never)} />
        </View>

        <View style={styles.heroCopy}>
          <AppText variant="display" style={styles.heroTitle}>
            Konaklama planların{'\n'}tek yerde.
          </AppText>
          <AppText variant="caption" style={styles.heroSubtitle}>
            Giriş/çıkış bilgileri, ödeme durumu ve tesis iletişimi burada.
          </AppText>
        </View>

        <View style={styles.heroStats}>
          <HeroStat label="Yaklaşan" value={`${counts.upcoming}`} icon="calendar" />
          <HeroStat label="Toplam gece" value={`${stats.nights}`} icon="moon" />
          <HeroStat label="Onay bekleyen" value={`${stats.pending}`} icon="time" />
          <HeroStat
            label="Toplam tutar"
            value={formatMoneyCents(stats.spend, 'TRY', { compact: true, decimals: false })}
            icon="wallet"
          />
        </View>
      </AuroraBackdrop>

      <View style={[styles.body, { paddingHorizontal: layout.isDesktop ? 28 : theme.layout.screenPadding }]}>
        <SegmentedTabs
          items={[
            { key: 'upcoming', label: 'Yaklaşan', icon: 'calendar-outline', count: counts.upcoming },
            { key: 'past', label: 'Geçmiş', icon: 'checkmark-done-outline', count: counts.past },
            { key: 'cancelled', label: 'İptal & süresi dolan', icon: 'close-circle-outline', count: counts.cancelled },
          ]}
          value={tab}
          onChange={setTab}
        />

        {reservations.isLoading ? (
          <View style={styles.list}>
            <LoadingBlock height={168} />
            <LoadingBlock height={168} />
          </View>
        ) : reservations.isError ? (
          <InlineError
            message={reservations.error instanceof Error ? reservations.error.message : 'Rezervasyonlar yüklenemedi.'}
            onRetry={() => void reservations.refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="calendar-clear-outline"
            title={tab === 'upcoming' ? 'Yaklaşan rezervasyon yok' : tab === 'past' ? 'Geçmiş konaklama yok' : 'İptal kaydı yok'}
            message={
              tab === 'upcoming'
                ? 'Trabzon’daki tesisleri keşfederek ilk rezervasyonunu oluşturabilirsin.'
                : 'Bu sekmede gösterilecek bir kayıt bulunmuyor.'
            }
            actionLabel={tab === 'upcoming' ? 'Tesisleri keşfet' : undefined}
            onAction={tab === 'upcoming' ? () => router.push('/konaklama' as never) : undefined}
          />
        ) : (
          <View style={styles.list}>
            {filtered.map((reservation) => (
              <ReservationCard
                key={reservation.id}
                reservation={reservation}
                desktop={layout.isDesktop}
                onPress={() => setSelectedId(reservation.id)}
                onOpenProperty={() => router.push(`/konaklama/${reservation.property.id}` as never)}
              />
            ))}
          </View>
        )}

        {items.length > 0 ? (
          <View style={[styles.footNote, { borderTopColor: theme.colors.divider }]}>
            <Ionicons name="shield-checkmark-outline" size={15} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary" style={styles.flex}>
              Ödemeler tesiste yapılır. İptal ve değişiklik koşulları rezervasyon onayında gösterilen tesis politikasına
              göre uygulanır.
            </AppText>
          </View>
        ) : null}
      </View>

      <MyReservationSheet
        reservationId={selectedId}
        onClose={() => setSelectedId(null)}
        onOpenProperty={(propertyId) => {
          setSelectedId(null);
          router.push(`/konaklama/${propertyId}` as never);
        }}
      />
    </Screen>
  );
}

function HeroStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}) {
  return (
    <View style={styles.heroStat}>
      <Ionicons name={icon} size={12} color="rgba(255,255,255,0.65)" />
      <AppText variant="bodyStrong" style={styles.heroStatValue}>
        {value}
      </AppText>
      <AppText variant="caption" style={styles.heroStatLabel} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function ReservationCard({
  reservation,
  desktop,
  onPress,
  onOpenProperty,
}: {
  reservation: MyReservation;
  desktop: boolean;
  onPress: () => void;
  onOpenProperty: () => void;
}) {
  const { theme } = useTheme();
  const tone = reservationTone(reservation.status);
  const payment = paymentTone(reservation.payment_status);
  const cover = accommodationMediaUrl(reservation.property.cover_path);
  const instant = reservation.booking_mode === 'instant';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${reservation.property.name} rezervasyonu, ${tone.label}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.xl,
          opacity: pressed ? 0.97 : 1,
        },
        theme.shadows.card,
      ]}
    >
      <View style={[styles.statusStrip, { backgroundColor: tone.color }]} />
      <View style={[desktop ? styles.cardRow : null]}>
        <View style={[desktop ? styles.cardImageDesktop : styles.cardImage]}>
          {cover ? (
            <AppImage source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <LinearGradient
              colors={[theme.colors.primarySoft, theme.colors.surfaceMuted]}
              style={[StyleSheet.absoluteFill, styles.cardImageFallback]}
            >
              <Ionicons name="business-outline" size={28} color={theme.colors.primaryDeep} />
            </LinearGradient>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(6,10,20,0.55)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.cardImageTop}>
            <GlassPill label={reservation.code} />
          </View>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardHead}>
            <View style={styles.flex}>
              <AppText variant="caption" color="textTertiary">
                {[reservation.property.district, reservation.room_type_name].filter(Boolean).join(' · ')}
              </AppText>
              <AppText variant="title" numberOfLines={1}>
                {reservation.property.name}
              </AppText>
            </View>
            <View style={[styles.statusPill, { backgroundColor: tone.background, borderColor: tone.border }]}>
              <View style={[styles.statusDot, { backgroundColor: tone.color }]} />
              <AppText variant="caption" style={{ color: tone.color, fontSize: 10 }}>
                {tone.label}
              </AppText>
            </View>
          </View>

          <View style={styles.dateRow}>
            <DateCell label="Giriş" value={formatDate(reservation.check_in)} />
            <View style={[styles.dateTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
              <View style={[styles.dateTrackDot, { backgroundColor: theme.colors.primary }]} />
              <View style={[styles.dateTrackLine, { backgroundColor: theme.colors.border }]} />
              <View style={styles.nightsPill}>
                <AppText variant="caption" color="textSecondary" style={styles.nightsText}>
                  {reservation.nights} gece
                </AppText>
              </View>
              <View style={[styles.dateTrackLine, { backgroundColor: theme.colors.border }]} />
              <View style={[styles.dateTrackDot, { backgroundColor: theme.colors.accent }]} />
            </View>
            <DateCell label="Çıkış" value={formatDate(reservation.check_out)} align="right" />
          </View>

          <View style={styles.cardMeta}>
            <View style={[styles.metaPill, { backgroundColor: payment.background }]}>
              <Ionicons name="card-outline" size={11} color={payment.color} />
              <AppText variant="caption" style={{ color: payment.color, fontSize: 10 }}>
                {paymentStatusLabel(reservation.payment_status)}
              </AppText>
            </View>
            <View style={[styles.metaPill, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons name={instant ? 'flash' : 'time-outline'} size={11} color={theme.colors.textSecondary} />
              <AppText variant="caption" color="textSecondary" style={styles.metaPillText}>
                {instant ? 'Anında onay' : 'Onaylı rezervasyon'}
              </AppText>
            </View>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {guestCount(reservation.adults, reservation.children)}
            </AppText>
          </View>

          <View style={[styles.cardFoot, { borderTopColor: theme.colors.divider }]}>
            <View style={styles.flex}>
              <AppText variant="caption" color="textTertiary" style={styles.totalCaption}>
                toplam
              </AppText>
              <MoneyText cents={reservation.total_cents} currency={reservation.currency} variant="bodyStrong" />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${reservation.property.name} tesis sayfası`}
              onPress={onOpenProperty}
              style={({ pressed }) => [
                styles.ghostButton,
                { borderColor: theme.colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="business-outline" size={13} color={theme.colors.textSecondary} />
              <AppText variant="caption" color="textSecondary" style={styles.ghostButtonText}>
                Tesis
              </AppText>
            </Pressable>
            <View style={[styles.detailButton, { backgroundColor: theme.colors.primarySoft }]}>
              <AppText variant="caption" color="primaryDeep" style={styles.detailButtonText}>
                Detay
              </AppText>
              <Ionicons name="chevron-forward" size={13} color={theme.colors.primaryDeep} />
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function DateCell({ label, value, align = 'left' }: { label: string; value: string; align?: 'left' | 'right' }) {
  return (
    <View style={[styles.dateCell, align === 'right' ? styles.dateCellRight : null]}>
      <AppText variant="caption" color="textTertiary" style={styles.dateCellLabel}>
        {label}
      </AppText>
      <AppText variant="caption" color="text" style={styles.dateCellValue}>
        {value}
      </AppText>
    </View>
  );
}

function MyReservationSheet({
  reservationId,
  onClose,
  onOpenProperty,
}: {
  reservationId: string | null;
  onClose: () => void;
  onOpenProperty: (propertyId: string) => void;
}) {
  const { theme } = useTheme();
  const detail = useMyReservation(reservationId);
  const cancel = useCancelMyReservation();
  const createReview = useCreateReview();

  const [cancelMode, setCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [cleanliness, setCleanliness] = useState(5);
  const [staffScore, setStaffScore] = useState(5);
  const [locationScore, setLocationScore] = useState(5);
  const [valueScore, setValueScore] = useState(5);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = detail.data;
  const tone = data ? reservationTone(data.status) : null;
  const canReview = data ? ['checked_out', 'completed'].includes(data.status) : false;
  const cover = accommodationMediaUrl(data?.property.cover_path);

  const reset = () => {
    setCancelMode(false);
    setCancelReason('');
    setReviewOpen(false);
    setComment('');
    setMessage(null);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  return (
    <>
      <ModalSheet
        visible={Boolean(reservationId)}
        onClose={close}
        title={data ? data.property.name : 'Rezervasyon'}
        subtitle={data ? `${data.code} · ${BOOKING_MODE_LABELS[data.booking_mode] ?? data.booking_mode}` : undefined}
        footer={
          data ? (
            <View style={styles.sheetFooter}>
              <Button
                label="Tesis sayfası"
                variant="outline"
                onPress={() => onOpenProperty(data.property.id)}
                style={styles.flex}
              />
              {data.can_cancel ? (
                <Button label="İptal et" variant="danger" onPress={() => setCancelMode(true)} style={styles.flex} />
              ) : null}
              {canReview ? (
                <Button label="Değerlendir" onPress={() => setReviewOpen(true)} style={styles.flex} />
              ) : null}
            </View>
          ) : undefined
        }
      >
        {detail.isLoading ? (
          <LoadingBlock height={160} />
        ) : detail.isError || !data ? (
          <InlineError message="Rezervasyon detayı yüklenemedi." onRetry={() => void detail.refetch()} />
        ) : (
          <>
            <View style={styles.sheetHero}>
              {cover ? (
                <AppImage source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <LinearGradient colors={[AURORA.indigo, AURORA.violet]} style={StyleSheet.absoluteFill} />
              )}
              <LinearGradient
                colors={['transparent', 'rgba(5,9,18,0.82)']}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <View style={styles.sheetHeroContent}>
                <AppText variant="caption" style={styles.sheetHeroCode}>
                  {data.code}
                </AppText>
                <AppText variant="h3" style={styles.sheetHeroTitle} numberOfLines={1}>
                  {data.property.name}
                </AppText>
                <View style={styles.sheetHeroRow}>
                  <GlassPill icon="location-outline" label={data.property.district ?? 'Trabzon'} />
                  {tone ? <GlassPill label={tone.label} /> : null}
                </View>
              </View>
            </View>

            <View style={styles.sheetStats}>
              <SheetStat label="Giriş" value={formatDate(data.check_in)} icon="log-in-outline" />
              <SheetStat label="Çıkış" value={formatDate(data.check_out)} icon="log-out-outline" />
              <SheetStat label="Gece" value={`${data.nights}`} icon="moon-outline" />
              <SheetStat label="Misafir" value={`${data.adults + data.children}`} icon="people-outline" />
            </View>

            <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <KeyValueRow icon="bed-outline" label="Oda tipi" value={data.room_type_name} />
              <KeyValueRow icon="pricetag-outline" label="Fiyat planı" value={data.rate_plan_name} />
              <KeyValueRow icon="person-outline" label="Misafir" value={data.guest_name} />
              {data.guest_phone ? <KeyValueRow icon="call-outline" label="Telefon" value={data.guest_phone} /> : null}
              {data.guest_email ? <KeyValueRow icon="mail-outline" label="E-posta" value={data.guest_email} /> : null}
              <KeyValueRow icon="card-outline" label="Ödeme" value={paymentStatusLabel(data.payment_status)} />
              <KeyValueRow
                icon="wallet-outline"
                label="Toplam"
                value={<MoneyText cents={data.total_cents} currency={data.currency} variant="bodyStrong" />}
              />
              {data.discount_cents > 0 ? (
                <KeyValueRow
                  icon="pricetag-outline"
                  label="İndirim"
                  value={<MoneyText cents={-data.discount_cents} currency={data.currency} variant="caption" />}
                />
              ) : null}
              {data.hold_expires_at ? (
                <KeyValueRow icon="timer-outline" label="Onay süresi" value={formatDateTime(data.hold_expires_at)} />
              ) : null}
              {data.notes ? <KeyValueRow icon="document-text-outline" label="Not" value={data.notes} /> : null}
            </View>

            <View style={[styles.contactCard, { backgroundColor: theme.colors.primarySoft }]}>
              <View style={styles.flex}>
                <AppText variant="caption" color="primaryDeep" style={styles.contactTitle}>
                  Tesis iletişimi
                </AppText>
                <AppText variant="bodyStrong" color="primaryDeep" numberOfLines={1}>
                  {data.property.phone ?? 'Telefon belirtilmemiş'}
                </AppText>
                <AppText variant="caption" color="textSecondary">
                  Giriş {data.property.checkin_time} · Çıkış {data.property.checkout_time}
                </AppText>
              </View>
              <Ionicons name="call" size={18} color={theme.colors.primaryDeep} />
            </View>

            {data.history.length > 0 ? (
              <View style={{ gap: 8 }}>
                <AppText variant="bodyStrong">İşlem geçmişi</AppText>
                <View style={[styles.timeline, { borderColor: theme.colors.divider }]}>
                  {data.history.map((entry, index) => (
                    <View key={`${entry.to_status}-${index}`} style={styles.timelineRow}>
                      <View style={styles.timelineRail}>
                        <View style={[styles.timelineDot, { backgroundColor: theme.colors.primary }]} />
                        {index < data.history.length - 1 ? (
                          <View style={[styles.timelineLine, { backgroundColor: theme.colors.divider }]} />
                        ) : null}
                      </View>
                      <View style={styles.flex}>
                        <AppText variant="caption" color="textSecondary">
                          {reservationTone(entry.to_status as ReservationStatus).label}
                          {entry.from_status
                            ? ` ← ${reservationTone(entry.from_status as ReservationStatus).label}`
                            : ''}
                        </AppText>
                        <AppText variant="caption" color="textTertiary" style={styles.timelineTime}>
                          {formatDateTime(entry.created_at)}
                        </AppText>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {cancelMode ? (
              <View style={{ gap: 8 }}>
                <InfoBanner
                  tone="warning"
                  text="İptal koşulları tesisin iptal politikasına göre uygulanır. Onayladığında rezervasyon iptal edilir ve oda stoğu serbest bırakılır."
                />
                <TextField
                  label="İptal nedeni (opsiyonel)"
                  value={cancelReason}
                  onChangeText={setCancelReason}
                  placeholder="Örn. plan değişikliği"
                  multiline
                />
                {error ? <InlineError message={error} /> : null}
                {message ? <InfoBanner tone="success" text={message} /> : null}
                <View style={styles.sheetFooter}>
                  <Button label="Vazgeç" variant="outline" onPress={() => setCancelMode(false)} style={styles.flex} />
                  <Button
                    label="İptali onayla"
                    variant="danger"
                    loading={cancel.isPending}
                    onPress={async () => {
                      setError(null);
                      try {
                        await cancel.mutateAsync({ id: data.id, reason: cancelReason || undefined });
                        setMessage('Rezervasyon iptal edildi.');
                        setCancelMode(false);
                        void detail.refetch();
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : 'İptal işlemi tamamlanamadı.');
                      }
                    }}
                    style={styles.flex}
                  />
                </View>
              </View>
            ) : null}
          </>
        )}
      </ModalSheet>

      <ModalSheet
        visible={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Konaklamanı değerlendir"
        subtitle={data ? `${data.property.name} · ${data.code}` : undefined}
        footer={
          <Button
            label="Değerlendirmeyi gönder"
            loading={createReview.isPending}
            onPress={async () => {
              if (!data) return;
              setError(null);
              try {
                await createReview.mutateAsync({
                  reservationId: data.id,
                  rating,
                  comment: comment || null,
                  cleanliness,
                  staffScore,
                  locationScore,
                  valueScore,
                });
                setReviewOpen(false);
                setMessage('Değerlendirmen için teşekkürler.');
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Değerlendirme gönderilemedi.');
              }
            }}
          />
        }
      >
        <View style={{ gap: 10 }}>
          <View style={[styles.reviewScore, { backgroundColor: theme.colors.surfaceMuted }]}>
            <AppText variant="bodyStrong">Genel puan</AppText>
            <StarRating rating={rating} size={26} onChange={setRating} />
          </View>
          {[
            { label: 'Temizlik', value: cleanliness, set: setCleanliness },
            { label: 'Personel', value: staffScore, set: setStaffScore },
            { label: 'Konum', value: locationScore, set: setLocationScore },
            { label: 'Fiyat/performans', value: valueScore, set: setValueScore },
          ].map((row) => (
            <View key={row.label} style={styles.reviewScoreRow}>
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                {row.label}
              </AppText>
              <StarRating rating={row.value} size={17} onChange={row.set} />
            </View>
          ))}
          <TextField
            label="Yorumun"
            value={comment}
            onChangeText={setComment}
            placeholder="Konaklaman hakkında misafirlere yardımcı olacak bir yorum yaz."
            multiline
          />
          {error ? <InlineError message={error} /> : null}
        </View>
      </ModalSheet>

      {message && !cancelMode && !reviewOpen ? (
        <View style={styles.toast}>
          <InfoBanner tone="success" text={message} />
        </View>
      ) : null}
    </>
  );
}

function SheetStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.sheetStat, { backgroundColor: theme.colors.surfaceMuted }]}>
      <Ionicons name={icon} size={12} color={theme.colors.primaryDeep} />
      <AppText variant="caption" color="textTertiary" style={styles.sheetStatLabel}>
        {label}
      </AppText>
      <AppText variant="caption" color="text" style={styles.sheetStatValue} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  hero: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 22, gap: 16 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroBrand: { flex: 1, alignItems: 'center', gap: 2 },
  brandOverline: { color: 'rgba(255,255,255,0.65)', fontSize: 9, letterSpacing: 2.4 },
  brandTitle: { color: '#FFFFFF' },
  heroCopy: { gap: 6 },
  heroTitle: { color: '#FFFFFF', fontSize: 27, lineHeight: 34, letterSpacing: -0.8 },
  heroSubtitle: { color: 'rgba(255,255,255,0.68)', fontSize: 11, lineHeight: 16 },
  heroStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heroStat: {
    flex: 1,
    minWidth: 84,
    gap: 2,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  heroStatValue: { color: '#FFFFFF', fontSize: 15 },
  heroStatLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 9 },

  body: { width: '100%', maxWidth: 1280, alignSelf: 'center', paddingTop: 16, paddingBottom: 36, gap: 12 },
  list: { gap: 11 },

  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', position: 'relative' },
  statusStrip: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, zIndex: 2 },
  cardRow: { flexDirection: 'row' },
  cardImage: { width: '100%', height: 140 },
  cardImageDesktop: { width: 226, height: '100%', minHeight: 194 },
  cardImageFallback: { alignItems: 'center', justifyContent: 'center' },
  cardImageTop: { position: 'absolute', top: 9, left: 9 },
  cardBody: { flex: 1, padding: 14, gap: 10, minWidth: 0 },
  cardHead: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateCell: { gap: 1, minWidth: 66 },
  dateCellRight: { alignItems: 'flex-end' },
  dateCellLabel: { fontSize: 9 },
  dateCellValue: { fontSize: 11.5 },
  dateTrack: { flex: 1, height: 28, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, gap: 4 },
  dateTrackDot: { width: 5, height: 5, borderRadius: 3 },
  dateTrackLine: { flex: 1, height: 1 },
  nightsPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(65,105,245,0.12)' },
  nightsText: { fontSize: 9 },

  cardMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  metaPillText: { fontSize: 10 },

  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth },
  totalCaption: { fontSize: 9 },
  ghostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  ghostButtonText: { fontSize: 10 },
  detailButton: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 11, height: 30, borderRadius: 9 },
  detailButtonText: { fontSize: 10 },

  footNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 16,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  sheetFooter: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  sheetHero: { height: 132, borderRadius: 16, overflow: 'hidden', justifyContent: 'flex-end' },
  sheetHeroContent: { padding: 12, gap: 3 },
  sheetHeroCode: { color: 'rgba(255,255,255,0.7)', fontSize: 10, letterSpacing: 1.2 },
  sheetHeroTitle: { color: '#FFFFFF' },
  sheetHeroRow: { flexDirection: 'row', gap: 5, marginTop: 3 },
  sheetStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sheetStat: { flex: 1, minWidth: 72, padding: 9, borderRadius: 11, gap: 1 },
  sheetStatLabel: { fontSize: 9 },
  sheetStatValue: { fontSize: 11.5 },
  panel: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 13 },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 14 },
  contactTitle: { fontSize: 10 },
  timeline: { borderLeftWidth: StyleSheet.hairlineWidth, paddingLeft: 2, gap: 0 },
  timelineRow: { flexDirection: 'row', gap: 8 },
  timelineRail: { width: 14, alignItems: 'center' },
  timelineDot: { width: 7, height: 7, borderRadius: 4, marginTop: 5 },
  timelineLine: { flex: 1, width: 1, marginTop: 2 },
  timelineTime: { fontSize: 9 },
  reviewScore: { alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 12 },
  reviewScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toast: { marginTop: 8 },
});
