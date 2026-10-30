import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, View } from 'react-native';

import { AppImage, AppText, Button, Screen } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import {
  EmptyState,
  LoadingBlock,
  ModalSheet,
  StarRating,
} from '@/features/accommodation/components/AccommodationUI';
import { BookingQuoteSheet } from '@/features/accommodation/components/BookingQuoteSheet';
import { DatePickerModal } from '@/features/accommodation/components/DatePickerModal';
import { FullScreenGallery } from '@/features/accommodation/components/FullScreenGallery';
import {
  AURORA,
  AccDivider,
  AmenityGrid,
  GlassPill,
  PhotoMosaic,
  ScorePanel,
  SectionTitle,
  amenityIcon,
  ratingLabel,
} from '@/features/accommodation/components/PremiumUI';
import { usePublicProperty } from '@/features/accommodation/hooks/use-accommodation';
import { useAccommodationLayout } from '@/features/accommodation/hooks/use-accommodation-layout';
import { accommodationMediaUrl } from '@/features/accommodation/services/accommodation-media-service';
import type { PublicProperty, PublicRoomType } from '@/features/accommodation/types';
import {
  PROPERTY_TYPE_LABELS,
  formatDate,
  formatMoneyCents,
  formatNumber,
  guestCount,
  nightsBetween,
  todayIso,
} from '@/features/accommodation/utils/format';

const POLICY_LABELS: Record<string, string> = {
  cancellation: 'İptal koşulları',
  cancellation_policy: 'İptal koşulları',
  pets: 'Evcil hayvan politikası',
  pet_policy: 'Evcil hayvan politikası',
  children: 'Çocuk politikası',
  child_policy: 'Çocuk politikası',
  smoking: 'Sigara kullanımı',
  extra_bed: 'İlave yatak',
  payment: 'Ödeme koşulları',
  quiet_hours: 'Sessiz saatler',
  check_in_out: 'Giriş / çıkış',
};

function policyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'İzin verilir' : 'İzin verilmez';
  if (Array.isArray(value)) return value.map((entry) => policyValue(entry)).join(', ');
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${policyValue(entry)}`)
      .join(' · ');
  }
  return '—';
}

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const layout = useAccommodationLayout();
  const property = usePublicProperty(id);

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [dateOpen, setDateOpen] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const [checkIn, setCheckIn] = useState(todayIso());
  const [checkOut, setCheckOut] = useState('');
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [selected, setSelected] = useState<{ roomType: PublicRoomType; ratePlanId: string } | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [showAllAmenities, setShowAllAmenities] = useState(false);

  const data = property.data;
  const nights = checkOut ? nightsBetween(checkIn, checkOut) : 0;

  const selectedRatePlan = useMemo(() => {
    if (!selected) return null;
    return selected.roomType.rate_plans.find((plan) => plan.id === selected.ratePlanId) ?? null;
  }, [selected]);

  const images = useMemo(
    () =>
      (data?.media ?? [])
        .filter((item) => item.kind === 'image')
        .map((item) => ({
          id: item.id,
          storage_path: item.storage_path,
          caption: item.caption,
          uri: accommodationMediaUrl(item.storage_path),
        }))
        .filter((item): item is typeof item & { uri: string } => Boolean(item.uri)),
    [data?.media],
  );

  const minPrice = useMemo(() => {
    const prices = (data?.room_types ?? []).map((room) => room.base_price_cents).filter((price) => price > 0);
    return prices.length > 0 ? Math.min(...prices) : 0;
  }, [data?.room_types]);

  const openGallery = (storagePath?: string | null) => {
    const index = images.findIndex((item) => item.storage_path === storagePath);
    setGalleryIndex(index >= 0 ? index : 0);
    setGalleryOpen(true);
  };

  const startBooking = (roomType: PublicRoomType, ratePlanId?: string) => {
    const plan = ratePlanId ? roomType.rate_plans.find((entry) => entry.id === ratePlanId) : roomType.rate_plans[0];
    if (!plan) return;
    setSelected({ roomType, ratePlanId: plan.id });
    setBookingOpen(true);
  };

  if (property.isLoading) {
    return (
      <Screen edges={['top']} padded={false}>
        <View style={styles.loadingMosaic} />
        <View style={styles.loadingBody}>
          <LoadingBlock height={64} />
          <LoadingBlock height={130} />
          <LoadingBlock height={220} />
        </View>
      </Screen>
    );
  }

  if (property.isError || !data) {
    return (
      <Screen edges={['top']}>
        <View style={styles.errorTop}>
          <Pressable accessibilityRole="button" accessibilityLabel="Geri" onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
          </Pressable>
        </View>
        <EmptyState
          icon="alert-circle-outline"
          title="Tesis yüklenemedi"
          message={
            property.error instanceof Error
              ? property.error.message
              : 'Tesis bulunamadı veya yayından kaldırılmış olabilir.'
          }
          actionLabel="Geri dön"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const location = [data.neighborhood, data.district].filter(Boolean).join(', ') || 'Trabzon';
  const reviews = showAllReviews ? data.reviews : data.reviews.slice(0, 3);
  const amenities = showAllAmenities ? data.amenities : data.amenities.slice(0, 8);
  const policies = Object.entries(data.policies ?? {});
  const horizontalPadding = layout.isDesktop ? 32 : theme.layout.screenPadding;
  const bookLabel =
    data.room_types[0]?.rate_plans[0]?.booking_mode === 'manual' ? 'Rezervasyon talebi' : 'Rezervasyon yap';

  const share = () =>
    void Share.share({
      message: `${data.name} — Trabzone Konaklama\n${location}\nGecelik ${formatMoneyCents(minPrice)}`,
    });

  return (
    <Screen scroll padded={false} edges={['top', 'left', 'right']}>
      <PhotoMosaic
        images={images}
        onPress={(index) => {
          setGalleryIndex(index);
          setGalleryOpen(true);
        }}
        onBack={() => router.back()}
        onShare={share}
        badge={
          data.verification_status === 'verified' ? <GlassPill icon="shield-checkmark" label="Doğrulanmış tesis" /> : null
        }
      />

      <View style={[styles.page, { paddingHorizontal: horizontalPadding }]}>
        <View style={[styles.layoutRow, layout.isDesktop ? styles.layoutRowDesktop : null]}>
          <View style={styles.main}>
            {/* Kimlik */}
            <View style={styles.identity}>
              <View style={styles.identityBadges}>
                <View style={[styles.typeBadge, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name="bed-outline" size={12} color={theme.colors.primaryDeep} />
                  <AppText variant="caption" color="primaryDeep" style={styles.typeBadgeText}>
                    {PROPERTY_TYPE_LABELS[data.property_type]}
                  </AppText>
                </View>
                {data.room_types.some((room) => room.rate_plans.some((plan) => plan.booking_mode === 'instant')) ? (
                  <View style={[styles.typeBadge, { backgroundColor: theme.colors.successSoft }]}>
                    <Ionicons name="flash" size={11} color={theme.colors.success} />
                    <AppText variant="caption" color="success" style={styles.typeBadgeText}>
                      Anında onay
                    </AppText>
                  </View>
                ) : null}
                {data.view_count > 0 ? (
                  <View style={styles.viewBadge}>
                    <Ionicons name="eye-outline" size={11} color={theme.colors.textTertiary} />
                    <AppText variant="caption" color="textTertiary" style={styles.typeBadgeText}>
                      {formatNumber(data.view_count)} görüntüleme
                    </AppText>
                  </View>
                ) : null}
              </View>

              <AppText variant="h1" style={styles.title}>
                {data.name}
              </AppText>

              <View style={styles.metaRow}>
                <Ionicons name="location" size={14} color={theme.colors.primaryDeep} />
                <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                  {location}
                </AppText>
                <View style={styles.metaDot} />
                <StarRating rating={data.rating_avg} size={12} />
                <AppText variant="caption" color="text" style={styles.metaScore}>
                  {data.rating_count > 0 ? `${data.rating_avg.toFixed(1)} (${data.rating_count})` : 'Yeni tesis'}
                </AppText>
              </View>

              {data.address ? (
                <View style={styles.addressRow}>
                  <Ionicons name="map-outline" size={13} color={theme.colors.textTertiary} />
                  <AppText variant="caption" color="textTertiary" style={styles.flex}>
                    {data.address}
                  </AppText>
                </View>
              ) : null}
            </View>

            {/* Hızlı bilgiler */}
            <View style={styles.factRow}>
              <Fact icon="people-outline" label="Kapasite" value={data.room_capacity ? `${data.room_capacity} kişi` : '—'} />
              <Fact icon="log-in-outline" label="Giriş" value={data.checkin_time} />
              <Fact icon="log-out-outline" label="Çıkış" value={data.checkout_time} />
              <Fact icon="language-outline" label="Diller" value={data.languages.length > 0 ? `${data.languages.length} dil` : '—'} />
            </View>

            {/* Tarih & misafir */}
            <View
              style={[
                styles.dateBar,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.lg,
                },
                theme.shadows.sm,
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Giri? tarihi se?"
                onPress={() => setDateOpen(true)}
                style={({ pressed }) => [styles.dateCol, { opacity: pressed ? 0.7 : 1 }]}
              >
                <AppText variant="caption" color="textTertiary" style={styles.dateLabel}>
                  G?R??
                </AppText>
                <AppText variant="bodyStrong">{checkIn ? formatDate(checkIn) : 'Se?'}</AppText>
              </Pressable>
              <View style={[styles.dateDivider, { backgroundColor: theme.colors.divider }]} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="??k?? tarihi se?"
                onPress={() => setDateOpen(true)}
                style={({ pressed }) => [styles.dateCol, { opacity: pressed ? 0.7 : 1 }]}
              >
                <AppText variant="caption" color="textTertiary" style={styles.dateLabel}>
                  ?IKI?
                </AppText>
                <AppText variant="bodyStrong">{checkOut ? formatDate(checkOut) : 'Se?'}</AppText>
              </Pressable>
              <View style={[styles.dateDivider, { backgroundColor: theme.colors.divider }]} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Misafir say?s?n? d?zenle"
                onPress={() => setGuestOpen(true)}
                style={({ pressed }) => [styles.dateCol, { opacity: pressed ? 0.7 : 1 }]}
              >
                <AppText variant="caption" color="textTertiary" style={styles.dateLabel}>
                  M?SAF?R
                </AppText>
                <AppText variant="bodyStrong">{guestCount(adults, children)}</AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tarih se?"
                onPress={() => setDateOpen(true)}
                style={({ pressed }) => [
                  styles.dateCta,
                  { backgroundColor: theme.colors.primarySoft, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Ionicons name="calendar" size={16} color={theme.colors.primaryDeep} />
              </Pressable>
            </View>
            {nights > 0 ? (
              <View style={styles.nightsRow}>
                <Ionicons name="moon-outline" size={12} color={theme.colors.success} />
                <AppText variant="caption" color="success">
                  {nights} gece konaklama · fiyatlar seçilen tarihlere göre aşağıda güncellenir
                </AppText>
              </View>
            ) : null}

            {/* Kampanyalar */}
            {data.campaigns.length > 0 ? (
              <View style={styles.section}>
                <SectionTitle
                  overline="KAMPANYALAR"
                  title="Bu tesise özel fırsatlar"
                  icon="pricetag"
                  subtitle="Rezervasyon sırasında otomatik uygulanır"
                />
                <View style={styles.campaignList}>
                  {data.campaigns.slice(0, 4).map((campaign) => (
                    <LinearGradient
                      key={campaign.id}
                      colors={['#2B2568', '#4169F5', '#8057F4']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.campaignCard}
                    >
                      <View style={styles.campaignLeft}>
                        <AppText variant="display" style={styles.campaignValue}>
                          {campaign.discount_percent > 0
                            ? `%${formatNumber(campaign.discount_percent)}`
                            : campaign.fixed_price_cents
                              ? formatMoneyCents(campaign.fixed_price_cents, undefined, { decimals: false })
                              : 'Özel'}
                        </AppText>
                        <AppText variant="caption" style={styles.campaignValueHint}>
                          {campaign.discount_percent > 0 ? 'indirim' : 'fiyat'}
                        </AppText>
                      </View>
                      <View style={styles.campaignBody}>
                        <AppText variant="title" style={styles.campaignTitle} numberOfLines={1}>
                          {campaign.title}
                        </AppText>
                        <AppText variant="caption" style={styles.campaignMeta} numberOfLines={2}>
                          {campaign.min_nights > 1 ? `Min. ${campaign.min_nights} gece · ` : ''}
                          {formatDate(campaign.start_date)} – {formatDate(campaign.end_date)}
                        </AppText>
                      </View>
                      <Ionicons name="sparkles" size={18} color="rgba(255,255,255,0.65)" />
                    </LinearGradient>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Hakkında */}
            {data.description ? (
              <View style={styles.section}>
                <SectionTitle overline="TESİS" title="Tesis hakkında" icon="document-text" />
                <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <AppText variant="body" color="textSecondary" style={styles.description}>
                    {data.description}
                  </AppText>
                </View>
              </View>
            ) : null}

            {/* Olanaklar */}
            {data.amenities.length > 0 ? (
              <View style={styles.section}>
                <SectionTitle
                  overline="OLANAKLAR"
                  title="Tesis olanakları"
                  icon="grid"
                  subtitle={`${data.amenities.length} olanak listelendi`}
                />
                <AmenityGrid items={amenities} />
                {data.amenities.length > 8 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={showAllAmenities ? 'Daha az olanak göster' : 'Tüm olanakları göster'}
                    onPress={() => setShowAllAmenities((current) => !current)}
                    style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.65 : 1 }]}
                  >
                    <AppText variant="caption" color="primaryDeep" style={styles.textButtonLabel}>
                      {showAllAmenities ? 'Daha az göster' : `Tüm olanakları göster (${data.amenities.length})`}
                    </AppText>
                    <Ionicons
                      name={showAllAmenities ? 'chevron-up' : 'chevron-down'}
                      size={13}
                      color={theme.colors.primaryDeep}
                    />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* Odalar */}
            <View style={styles.section}>
              <SectionTitle
                overline="ODALAR"
                title="Oda tipleri ve fiyatlar"
                icon="bed"
                subtitle={nights > 0 ? `${nights} gece için uygun odalar` : 'Tarih seçerek müsaitliği kontrol et'}
              />
              {data.room_types.length === 0 ? (
                <EmptyState icon="bed-outline" title="Oda tipi bulunamadı" message="Tesis henüz oda tipi eklememiş." />
              ) : (
                <View style={styles.roomList}>
                  {data.room_types.map((room) => {
                    const roomPhotos = room.photos
                      .map((path) => accommodationMediaUrl(path))
                      .filter((uri): uri is string => Boolean(uri));
                    const roomCover = roomPhotos[0] ?? accommodationMediaUrl(room.cover_path);
                    const total = nights > 0 ? room.base_price_cents * nights : null;
                    return (
                      <View
                        key={room.id}
                        style={[
                          styles.roomCard,
                          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                        ]}
                      >
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${room.name} fotoğrafları`}
                          onPress={() => openGallery(room.cover_path ?? room.photos[0])}
                          style={layout.isDesktop ? styles.roomImageDesktop : styles.roomImage}
                        >
                          {roomCover ? (
                            <AppImage source={{ uri: roomCover }} style={StyleSheet.absoluteFill} contentFit="cover" />
                          ) : (
                            <LinearGradient
                              colors={[theme.colors.primarySoft, theme.colors.surfaceMuted]}
                              style={[StyleSheet.absoluteFill, styles.roomImageFallback]}
                            >
                              <Ionicons name="bed-outline" size={26} color={theme.colors.primaryDeep} />
                            </LinearGradient>
                          )}
                          {roomPhotos.length > 1 ? (
                            <View style={styles.roomPhotoCount}>
                              <Ionicons name="images-outline" size={10} color="#FFFFFF" />
                              <AppText variant="caption" style={styles.roomPhotoCountText}>
                                {roomPhotos.length}
                              </AppText>
                            </View>
                          ) : null}
                        </Pressable>

                        <View style={[styles.roomBody, layout.isDesktop ? styles.roomBodyDesktop : null]}>
                          <View style={styles.roomHead}>
                            <View style={styles.flex}>
                              <AppText variant="title">{room.name}</AppText>
                              <AppText variant="caption" color="textTertiary">
                                {guestCount(room.capacity_adults, room.capacity_children)}
                                {room.bed_setup ? ` · ${room.bed_setup}` : ''}
                                {room.size_m2 ? ` · ${room.size_m2} m²` : ''}
                                {room.view ? ` · ${room.view}` : ''}
                              </AppText>
                            </View>
                            <View style={styles.roomPrice}>
                              <AppText variant="caption" color="textTertiary" style={styles.roomPriceCaption}>
                                gecelik
                              </AppText>
                              <AppText variant="h3" color="primaryDeep">
                                {formatMoneyCents(room.base_price_cents, room.currency, { decimals: false })}
                              </AppText>
                            </View>
                          </View>

                          <View style={styles.roomTags}>
                            {room.breakfast ? <RoomTag icon="cafe-outline" label="Kahvaltı dahil" /> : null}
                            {room.balcony ? <RoomTag icon="sunny-outline" label="Balkon" /> : null}
                            {room.air_conditioning ? <RoomTag icon="snow-outline" label="Klima" /> : null}
                            {room.wifi ? <RoomTag icon="wifi-outline" label="Wi-Fi" /> : null}
                            {room.amenities.slice(0, 2).map((amenity) => (
                              <RoomTag key={amenity} icon={amenityIcon(amenity)} label={amenity} />
                            ))}
                          </View>

                          <View style={styles.rateList}>
                            {room.rate_plans.map((plan) => (
                              <Pressable
                                key={plan.id}
                                accessibilityRole="button"
                                accessibilityLabel={`${room.name} · ${plan.name}`}
                                onPress={() => startBooking(room, plan.id)}
                                style={({ pressed }) => [
                                  styles.rateRow,
                                  {
                                    borderColor:
                                      selected?.ratePlanId === plan.id ? theme.colors.primary : theme.colors.border,
                                    backgroundColor:
                                      selected?.ratePlanId === plan.id
                                        ? theme.colors.primarySoft
                                        : theme.colors.surfaceMuted,
                                    opacity: pressed ? 0.85 : 1,
                                  },
                                ]}
                              >
                                <View
                                  style={[
                                    styles.modeDot,
                                    {
                                      backgroundColor:
                                        plan.booking_mode === 'instant' ? theme.colors.success : theme.colors.warning,
                                    },
                                  ]}
                                />
                                <View style={styles.flex}>
                                  <AppText variant="caption" color="text" numberOfLines={1}>
                                    {plan.name}
                                  </AppText>
                                  <AppText variant="caption" color="textTertiary" style={styles.rateMeta}>
                                    {plan.booking_mode === 'instant' ? 'Anında onay' : 'Manuel onay'}
                                    {plan.includes_breakfast ? ' · Kahvaltı dahil' : ''}
                                    {plan.cancellation_hours > 0 ? ` · ${plan.cancellation_hours} sa iptal` : ''}
                                    {plan.min_stay > 1 ? ` · min. ${plan.min_stay} gece` : ''}
                                  </AppText>
                                </View>
                                <Ionicons name="chevron-forward" size={14} color={theme.colors.textTertiary} />
                              </Pressable>
                            ))}
                          </View>

                          {total ? (
                            <View style={[styles.roomTotal, { borderTopColor: theme.colors.divider }]}>
                              <AppText variant="caption" color="textSecondary">
                                {nights} gece tahmini toplam
                              </AppText>
                              <AppText variant="bodyStrong" color="primaryDeep">
                                {formatMoneyCents(total, room.currency, { decimals: false })}
                              </AppText>
                            </View>
                          ) : null}

                          <Button
                            label={
                              room.rate_plans[0]?.booking_mode === 'manual'
                                ? 'Bu oda için talep gönder'
                                : 'Bu odayı rezerve et'
                            }
                            size="sm"
                            fullWidth={false}
                            leftIcon={<Ionicons name="arrow-forward-circle" size={16} color={theme.colors.onPrimary} />}
                            onPress={() => startBooking(room)}
                            style={styles.roomCta}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Puanlar */}
            <View style={styles.section}>
              <SectionTitle
                overline="DEĞERLENDİRMELER"
                title="Misafir deneyimi"
                icon="star"
                subtitle={data.rating_count > 0 ? `${data.rating_count} doğrulanmış konaklama yorumu` : 'Henüz değerlendirme yok'}
              />
              <ScorePanel
                rating={data.rating_avg}
                count={data.rating_count}
                breakdown={[
                  { key: 'cleanliness', label: 'Temizlik', value: data.rating_breakdown.cleanliness ?? 0 },
                  { key: 'staff', label: 'Personel', value: data.rating_breakdown.staff ?? 0 },
                  { key: 'location', label: 'Konum', value: data.rating_breakdown.location ?? 0 },
                  { key: 'value', label: 'Fiyat / performans', value: data.rating_breakdown.value ?? 0 },
                ]}
              />

              {reviews.length === 0 ? (
                <EmptyState
                  icon="chatbubble-ellipses-outline"
                  title="Henüz yorum yok"
                  message="İlk değerlendirmeyi konaklayan misafirler yapacak."
                  compact
                />
              ) : (
                <View style={styles.reviewList}>
                  {reviews.map((review) => (
                    <View
                      key={review.id}
                      style={[styles.reviewCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                    >
                      <View style={styles.reviewHead}>
                        <LinearGradient
                          colors={[theme.colors.primary, theme.colors.accent]}
                          style={styles.avatar}
                        >
                          <AppText variant="caption" style={styles.avatarText}>
                            {review.guest_name.slice(0, 1).toLocaleUpperCase('tr-TR')}
                          </AppText>
                        </LinearGradient>
                        <View style={styles.flex}>
                          <AppText variant="bodyStrong">{review.guest_name}</AppText>
                          <AppText variant="caption" color="textTertiary">
                            {formatDate(review.created_at.slice(0, 10))} · {ratingLabel(review.rating, 1)}
                          </AppText>
                        </View>
                        <StarRating rating={review.rating} size={12} />
                      </View>
                      {review.comment ? (
                        <AppText variant="body" color="textSecondary">
                          {review.comment}
                        </AppText>
                      ) : null}
                      {review.owner_reply ? (
                        <View style={[styles.ownerReply, { backgroundColor: theme.colors.surfaceMuted }]}>
                          <View style={styles.ownerReplyHead}>
                            <Ionicons name="business" size={11} color={theme.colors.primaryDeep} />
                            <AppText variant="caption" color="primaryDeep" style={styles.ownerReplyLabel}>
                              Tesis yanıtı
                            </AppText>
                          </View>
                          <AppText variant="caption" color="textSecondary">
                            {review.owner_reply}
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}

              {data.reviews.length > 3 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showAllReviews ? 'Daha az yorum göster' : 'Tüm yorumları göster'}
                  onPress={() => setShowAllReviews((current) => !current)}
                  style={({ pressed }) => [
                    styles.moreButton,
                    { borderColor: theme.colors.borderStrong, opacity: pressed ? 0.75 : 1 },
                  ]}
                >
                  <AppText variant="caption" color="text">
                    {showAllReviews ? 'Daha az göster' : `Tüm yorumları göster (${data.reviews.length})`}
                  </AppText>
                  <Ionicons name={showAllReviews ? 'chevron-up' : 'chevron-down'} size={14} color={theme.colors.text} />
                </Pressable>
              ) : null}
            </View>

            {/* Politika & iletişim */}
            <View style={styles.section}>
              <SectionTitle overline="BİLGİLER" title="Konaklama kuralları" icon="information-circle" />
              <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <PolicyRow icon="log-in-outline" label="Giriş saati" value={data.checkin_time} />
                <AccDivider />
                <PolicyRow icon="log-out-outline" label="Çıkış saati" value={data.checkout_time} />
                {policies.map(([key, value]) => (
                  <View key={key}>
                    <AccDivider />
                    <PolicyRow
                      icon="shield-checkmark-outline"
                      label={POLICY_LABELS[key] ?? key.replace(/_/g, ' ')}
                      value={policyValue(value)}
                    />
                  </View>
                ))}
                {data.languages.length > 0 ? (
                  <>
                    <AccDivider />
                    <PolicyRow icon="language-outline" label="Konuşulan diller" value={data.languages.join(', ')} />
                  </>
                ) : null}
              </View>
            </View>

            {/* Konum & iletişim */}
            <View style={styles.section}>
              <SectionTitle overline="KONUM" title="Ulaşım ve iletişim" icon="navigate" />
              <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <View style={styles.locationBlock}>
                  <View style={[styles.locationIcon, { backgroundColor: theme.colors.primarySoft }]}>
                    <Ionicons name="location" size={18} color={theme.colors.primaryDeep} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">{location}</AppText>
                    <AppText variant="caption" color="textTertiary">
                      {data.address ?? 'Adres bilgisi belirtilmemiş'}
                    </AppText>
                  </View>
                </View>

                <View style={styles.contactRow}>
                  {data.phone ? (
                    <ContactChip
                      icon="call-outline"
                      label="Ara"
                      onPress={() => void Linking.openURL(`tel:${data.phone}`)}
                    />
                  ) : null}
                  {data.email ? (
                    <ContactChip
                      icon="mail-outline"
                      label="E-posta"
                      onPress={() => void Linking.openURL(`mailto:${data.email}`)}
                    />
                  ) : null}
                  {data.website ? (
                    <ContactChip
                      icon="globe-outline"
                      label="Web sitesi"
                      onPress={() => void Linking.openURL(data.website as string)}
                    />
                  ) : null}
                </View>

                {data.lat && data.lng ? (
                  <Button
                    label="Haritada göster"
                    variant="outline"
                    size="sm"
                    leftIcon={<Ionicons name="map-outline" size={16} color={theme.colors.text} />}
                    onPress={() =>
                      void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${data.lat},${data.lng}`)
                    }
                  />
                ) : null}
              </View>
            </View>

            {property.isRefetching ? <LoadingBlock height={54} label="Güncelleniyor…" /> : null}
          </View>

          {layout.isDesktop ? (
            <View style={styles.side}>
              <BookingPanel
                data={data}
                checkIn={checkIn}
                checkOut={checkOut}
                adults={adults}
                childGuests={children}
                nights={nights}
                minPrice={minPrice}
                onPickDates={() => setDateOpen(true)}
                onBook={() => {
                  const first = data.room_types[0];
                  if (first) startBooking(first);
                  else setDateOpen(true);
                }}
                disabled={data.room_types.length === 0}
                label={bookLabel}
              />
            </View>
          ) : null}
        </View>
      </View>

      {!layout.isDesktop ? (
        <View
          style={[
            styles.bookBar,
            {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.border,
              paddingHorizontal: horizontalPadding,
              paddingBottom: 12,
            },
          ]}
        >
          <View style={styles.flex}>
            <AppText variant="caption" color="textTertiary" style={styles.bookBarCaption}>
              {nights > 0 ? `${nights} gece toplam` : 'gecelik başlangıç'}
            </AppText>
            <AppText variant="h3" color="primaryDeep">
              {formatMoneyCents(nights > 0 ? minPrice * nights : minPrice)}
            </AppText>
          </View>
          <Button
            label={bookLabel}
            onPress={() => {
              const first = data.room_types[0];
              if (first) startBooking(first);
              else setDateOpen(true);
            }}
            disabled={data.room_types.length === 0}
            style={styles.bookBarCta}
          />
        </View>
      ) : null}

      <DatePickerModal
        visible={dateOpen}
        mode="range"
        value={checkIn}
        endValue={checkOut || null}
        onClose={() => setDateOpen(false)}
        onSelectRange={(start, end) => {
          setCheckIn(start);
          setCheckOut(end ?? '');
          setDateOpen(false);
        }}
      />

      <ModalSheet
        visible={guestOpen}
        onClose={() => setGuestOpen(false)}
        title="Misafir say?s?"
        subtitle="Fiyat ve m?saitlik misafir say?s?na g?re do?rulan?r"
        maxWidth={420}
        footer={<Button label="Tamam" onPress={() => setGuestOpen(false)} />}
      >
        <GuestStepper label="Yeti?kin" hint="13 ya? ve ?zeri" value={adults} min={1} max={12} onChange={setAdults} />
        <GuestStepper label="?ocuk" hint="0 - 12 ya?" value={children} min={0} max={8} onChange={setChildren} />
      </ModalSheet>

      <FullScreenGallery
        visible={galleryOpen}
        media={data.media}
        initialIndex={galleryIndex}
        onClose={() => setGalleryOpen(false)}
      />

      <BookingQuoteSheet
        visible={bookingOpen}
        onClose={() => setBookingOpen(false)}
        property={data}
        roomType={selected?.roomType ?? null}
        ratePlan={selectedRatePlan}
        initialCheckIn={checkIn}
        initialCheckOut={checkOut || null}
        initialAdults={adults}
        initialChildren={children}
        onDone={() => {
          setBookingOpen(false);
          router.push('/konaklama/rezervasyonlarim' as never);
        }}
      />
    </Screen>
  );
}

function GuestStepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.stepperRow, { borderColor: theme.colors.border }]}>
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{label}</AppText>
        <AppText variant="caption" color="textTertiary">
          {hint}
        </AppText>
      </View>
      <View style={styles.stepperControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} azalt`}
          disabled={value <= min}
          onPress={() => onChange(Math.max(min, value - 1))}
          style={[
            styles.stepperButton,
            {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surfaceMuted,
              opacity: value <= min ? 0.4 : 1,
            },
          ]}
        >
          <Ionicons name="remove" size={16} color={theme.colors.text} />
        </Pressable>
        <AppText variant="bodyStrong" style={styles.stepperValue}>
          {value}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} art?r`}
          disabled={value >= max}
          onPress={() => onChange(Math.min(max, value + 1))}
          style={[
            styles.stepperButton,
            {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.primarySoft,
              opacity: value >= max ? 0.4 : 1,
            },
          ]}
        >
          <Ionicons name="add" size={16} color={theme.colors.primaryDeep} />
        </Pressable>
      </View>
    </View>
  );
}

function Fact({ icon, label, value }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.fact, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={[styles.factIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={14} color={theme.colors.primaryDeep} />
      </View>
      <View style={styles.flex}>
        <AppText variant="caption" color="textTertiary" style={styles.factLabel}>
          {label}
        </AppText>
        <AppText variant="caption" color="text" numberOfLines={1} style={styles.factValue}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

function RoomTag({ icon, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.roomTag, { backgroundColor: theme.colors.primarySoft }]}>
      <Ionicons name={icon} size={11} color={theme.colors.primaryDeep} />
      <AppText variant="caption" color="primaryDeep" style={styles.roomTagText} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function PolicyRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.policyRow}>
      <Ionicons name={icon} size={15} color={theme.colors.textTertiary} />
      <AppText variant="caption" color="textSecondary" style={styles.policyLabel}>
        {label}
      </AppText>
      <AppText variant="caption" color="text" style={styles.policyValue}>
        {value}
      </AppText>
    </View>
  );
}

function ContactChip({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.contactChip,
        { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Ionicons name={icon} size={14} color={theme.colors.primaryDeep} />
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
    </Pressable>
  );
}

function BookingPanel({
  data,
  checkIn,
  checkOut,
  adults,
  childGuests,
  nights,
  minPrice,
  onPickDates,
  onBook,
  disabled,
  label,
}: {
  data: PublicProperty;
  checkIn: string;
  checkOut: string;
  adults: number;
  childGuests: number;
  nights: number;
  minPrice: number;
  onPickDates: () => void;
  onBook: () => void;
  disabled: boolean;
  label: string;
}) {
  const { theme } = useTheme();
  const instant = data.room_types.some((room) => room.rate_plans.some((plan) => plan.booking_mode === 'instant'));

  return (
    <View style={styles.sideInner}>
      <View
        style={[
          styles.bookingCard,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          theme.shadows.card,
        ]}
      >
        <View style={styles.bookingHead}>
          <View style={styles.flex}>
            <AppText variant="caption" color="textTertiary" style={styles.bookingCaption}>
              {nights > 0 ? `${nights} gece toplam` : 'gecelik başlangıç'}
            </AppText>
            <AppText variant="h2" color="primaryDeep">
              {formatMoneyCents(nights > 0 ? minPrice * nights : minPrice)}
            </AppText>
          </View>
          {data.rating_count > 0 ? (
            <View style={[styles.bookingScore, { backgroundColor: theme.colors.primaryDeep }]}>
              <AppText variant="bodyStrong" style={styles.bookingScoreText}>
                {data.rating_avg.toFixed(1)}
              </AppText>
            </View>
          ) : null}
        </View>

        <View style={[styles.bookingGrid, { borderColor: theme.colors.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Giriş tarihi" onPress={onPickDates} style={styles.bookingCell}>
            <AppText variant="caption" color="textTertiary" style={styles.bookingCellLabel}>
              GİRİŞ
            </AppText>
            <AppText variant="caption" color="text" numberOfLines={1}>
              {formatDate(checkIn)}
            </AppText>
          </Pressable>
          <View style={[styles.bookingGridDivider, { backgroundColor: theme.colors.border }]} />
          <Pressable accessibilityRole="button" accessibilityLabel="Çıkış tarihi" onPress={onPickDates} style={styles.bookingCell}>
            <AppText variant="caption" color="textTertiary" style={styles.bookingCellLabel}>
              ÇIKIŞ
            </AppText>
            <AppText variant="caption" color="text" numberOfLines={1}>
              {checkOut ? formatDate(checkOut) : 'Seç'}
            </AppText>
          </Pressable>
          <View style={[styles.bookingGridDivider, { backgroundColor: theme.colors.border }]} />
          <Pressable accessibilityRole="button" accessibilityLabel="Misafir sayısı" onPress={onPickDates} style={styles.bookingCell}>
            <AppText variant="caption" color="textTertiary" style={styles.bookingCellLabel}>
              MİSAFİR
            </AppText>
            <AppText variant="caption" color="text" numberOfLines={1}>
              {adults + childGuests} kişi
            </AppText>
          </Pressable>
        </View>

        <Button label={label} onPress={onBook} disabled={disabled} />

        <View style={styles.bookingTrust}>
          <TrustLine icon={instant ? 'flash' : 'time'} label={instant ? 'Anında onaylanır' : 'Tesis onayı ile kesinleşir'} />
          <TrustLine icon="cash-outline" label="Ödemeyi tesiste yaparsın" />
          <TrustLine icon="shield-checkmark-outline" label="Trabzone güvenli rezervasyon" />
          <TrustLine icon="headset-outline" label="Tesis ile doğrudan mesajlaşma" />
        </View>
      </View>

      <View style={[styles.sideNote, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name="information-circle" size={15} color={theme.colors.primaryDeep} />
        <AppText variant="caption" color="primaryDeep" style={styles.flex}>
          Kesin fiyat, müsaitlik ve iptal koşulları rezervasyon adımında sunucu tarafında doğrulanır.
        </AppText>
      </View>
    </View>
  );
}

function TrustLine({ icon, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.trustLine}>
      <Ionicons name={icon} size={13} color={theme.colors.success} />
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingMosaic: { height: 260, backgroundColor: AURORA.indigo },
  loadingBody: { padding: 20, gap: 12 },
  errorTop: { padding: 16 },

  page: { width: '100%', maxWidth: 1280, alignSelf: 'center', paddingTop: 20, paddingBottom: 120, gap: 18 },
  layoutRow: { gap: 18 },
  layoutRowDesktop: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  main: { flex: 1, gap: 18, minWidth: 0 },
  side: { width: 352 },

  identity: { gap: 8 },
  identityBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  typeBadgeText: { fontSize: 10 },
  viewBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 4 },
  title: { fontSize: 28, lineHeight: 34 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#94A3B8', marginHorizontal: 2 },
  metaScore: { fontSize: 11 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },

  factRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fact: {
    flex: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  factIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  factLabel: { fontSize: 9 },
  factValue: { fontSize: 11.5 },

  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dateCol: { flex: 1, gap: 2, minWidth: 0 },
  dateLabel: { fontSize: 9 },
  dateDivider: { width: StyleSheet.hairlineWidth, height: 30 },
  dateCta: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperButton: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  stepperValue: { minWidth: 22, textAlign: 'center', fontVariant: ['tabular-nums'] },
  nightsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2 },

  section: { gap: 10, paddingTop: 4 },
  panel: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 4 },
  description: { lineHeight: 23 },

  campaignList: { gap: 8 },
  campaignCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 16 },
  campaignLeft: { minWidth: 62, alignItems: 'flex-start' },
  campaignValue: { color: '#FFFFFF', fontSize: 28, lineHeight: 32 },
  campaignValueHint: { color: 'rgba(255,255,255,0.66)', fontSize: 9 },
  campaignBody: { flex: 1, gap: 2 },
  campaignTitle: { color: '#FFFFFF' },
  campaignMeta: { color: 'rgba(255,255,255,0.7)', fontSize: 10 },

  roomList: { gap: 12 },
  roomCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  roomImage: { width: '100%', height: 168 },
  roomImageDesktop: { width: 236, height: '100%', minHeight: 210, position: 'absolute', left: 0, top: 0, bottom: 0 },
  roomImageFallback: { alignItems: 'center', justifyContent: 'center' },
  roomPhotoCount: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(8,13,26,0.6)',
  },
  roomPhotoCountText: { color: '#FFFFFF', fontSize: 9 },
  roomBody: { flex: 1, padding: 14, gap: 9, marginLeft: 0 },
  roomBodyDesktop: { paddingLeft: 252 },
  roomHead: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  roomPrice: { alignItems: 'flex-end', gap: 1 },
  roomPriceCaption: { fontSize: 9 },
  roomTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  roomTag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  roomTagText: { fontSize: 9 },
  rateList: { gap: 6 },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 9,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modeDot: { width: 6, height: 6, borderRadius: 3 },
  rateMeta: { fontSize: 9 },
  roomTotal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth },
  roomCta: { alignSelf: 'flex-start', marginTop: 2 },

  reviewList: { gap: 9 },
  reviewCard: { borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, padding: 13, gap: 8 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  avatar: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF' },
  ownerReply: { borderRadius: 11, padding: 10, gap: 4 },
  ownerReplyHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ownerReplyLabel: { fontSize: 10 },
  textButton: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
  textButtonLabel: { fontSize: 11 },
  moreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },

  policyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 7 },
  policyLabel: { width: 132 },
  policyValue: { flex: 1, textAlign: 'right' },

  locationBlock: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 4 },
  locationIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingVertical: 6 },
  contactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },

  sideInner: { gap: 10 },
  bookingCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  bookingHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bookingCaption: { fontSize: 10 },
  bookingScore: { minWidth: 44, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 11, alignItems: 'center' },
  bookingScoreText: { color: '#FFFFFF' },
  bookingGrid: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  bookingCell: { flex: 1, paddingHorizontal: 9, paddingVertical: 9, gap: 2 },
  bookingCellLabel: { fontSize: 8 },
  bookingGridDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  bookingTrust: { gap: 7, paddingTop: 2 },
  trustLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sideNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 11, borderRadius: 12 },

  bookBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bookBarCaption: { fontSize: 10 },
  bookBarCta: { minWidth: 176 },
});
