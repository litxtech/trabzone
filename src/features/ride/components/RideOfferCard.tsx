import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';

import { AppImage, AppText, Avatar, Button } from '@/components/ui';
import { MarketMediaViewer, type MarketMediaViewerItem } from '@/features/marketplace/components/MarketMediaViewer';
import { ProfilePreviewSheet } from '@/features/profile/components/ProfilePreviewSheet';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { siteBase } from '@/features/share/links';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

import { useSaveFavorite } from '../hooks/use-ride';
import { rideVehiclePhotoUrl } from '../services/ride-service';
import type { OfferStatus, RideSearchItem } from '../types';
import {
  dayLabel,
  formatDistance,
  formatDuration,
  formatMoney,
  formatShortDate,
  formatTime,
  initials,
  RESERVATION_STATUS_LABEL,
} from '../utils/format';
import { VerifiedTick } from './IdentityBadge';

const FUEL_LABEL: Record<string, string> = {
  gasoline: 'Benzin',
  diesel: 'Dizel',
  lpg: 'LPG',
  hybrid: 'Hibrit',
  electric: 'Elektrik',
};

const STATUS_META: Record<
  OfferStatus,
  { label: string; icon: keyof typeof Ionicons.glyphMap; key: 'primary' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral' }
> = {
  draft: { label: 'Taslak', icon: 'document-outline', key: 'neutral' },
  published: { label: 'Yayında', icon: 'radio-outline', key: 'primary' },
  full: { label: 'Dolu', icon: 'people', key: 'warning' },
  started: { label: 'Yolculuk başladı', icon: 'navigate-circle', key: 'accent' },
  completed: { label: 'Tamamlandı', icon: 'checkmark-done-circle', key: 'success' },
  cancelled: { label: 'İptal edildi', icon: 'close-circle', key: 'danger' },
  expired: { label: 'Süresi doldu', icon: 'time-outline', key: 'neutral' },
};

function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) {
    return 'az önce';
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) {
    return `${minutes} dk önce`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} sa önce`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} gün önce`;
  }
  return formatShortDate(iso);
}

/**
 * Arama ve ana sayfa listelerindeki premium ilan kartı.
 *
 * - Sürücü avatarı/kullanıcı adı profil önizlemesini açar.
 * - Araç fotoğrafı tam ekran galeriyi açar (mevcut MarketMediaViewer).
 * - Rota, süre, mesafe, boş koltuk ve rezervasyon durumu tek bakışta görünür.
 * - Tüm eylemler gerçek akışlara bağlıdır: detay, rezervasyon, kaydet, paylaş.
 *
 * Kart yalnızca değişen alanları güncelleyen Realtime patch'leriyle beslenir;
 * bu bileşen kendi içinde ek ağ isteği yapmaz.
 */
export const RideOfferCard = memo(function RideOfferCard({ offer }: { offer: RideSearchItem }) {
  const { theme } = useTheme();
  const router = useRouter();
  const saveFavorite = useSaveFavorite();

  const [profileOpen, setProfileOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [photoError, setPhotoError] = useState(false);
  const [saved, setSaved] = useState(false);

  const driverName =
    [offer.driver.first_name, offer.driver.username].filter(Boolean).join(' ') || 'Sürücü';
  const driverHandle = offer.driver.username ? `@${offer.driver.username}` : 'Sürücü';
  const vehicleName = [offer.vehicle.make, offer.vehicle.model].filter(Boolean).join(' ');
  const vehiclePhotos = (offer.vehicle.photo_paths ?? [])
    .map((path) => rideVehiclePhotoUrl(path))
    .filter((url): url is string => Boolean(url));
  const viewerItems: MarketMediaViewerItem[] = vehiclePhotos.map((uri, index) => ({
    id: `${offer.id}-vehicle-${index}`,
    kind: 'image',
    uri,
  }));
  const coverPhoto = vehiclePhotos[0] ?? null;
  const published = relativeTime(offer.created_at ?? offer.published_at ?? undefined);
  const seatsAvailable = Math.max(0, offer.seats_available);
  const isFull = seatsAvailable <= 0 || offer.status === 'full';
  const status = STATUS_META[offer.status] ?? STATUS_META.published;
  const statusColor =
    status.key === 'neutral' ? theme.colors.textTertiary : theme.colors[status.key];
  const reservationStatus = offer.my_reservation_status ?? null;
  const vehicleMeta = [
    offer.vehicle.color,
    offer.vehicle.fuel_type ? FUEL_LABEL[offer.vehicle.fuel_type] ?? offer.vehicle.fuel_type : null,
    offer.vehicle.seat_capacity ? `${offer.vehicle.seat_capacity} kişilik` : null,
    offer.vehicle.has_ac ? 'Klima' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const publishedLine = [
    offer.driver.rating_avg ? `${offer.driver.rating_avg.toFixed(1)} ★` : null,
    offer.driver.review_count ? `${offer.driver.review_count} değerlendirme` : null,
    published,
  ]
    .filter(Boolean)
    .join(' · ');

  const openDetails = () => {
    haptics.selection();
    router.navigate(`/ride/offers/${offer.id}` as never);
  };

  const openProfile = (event?: GestureResponderEvent) => {
    event?.stopPropagation();
    haptics.selection();
    setProfileOpen(true);
  };

  const openViewer = (event: GestureResponderEvent) => {
    event.stopPropagation();
    if (!viewerItems.length) {
      return;
    }
    haptics.selection();
    setViewerIndex(0);
    setViewerOpen(true);
  };

  const handleShare = async (event: GestureResponderEvent) => {
    event.stopPropagation();
    haptics.selection();
    const link = `${siteBase()}/ride/offers/${offer.id}`;
    const message = [
      `${offer.origin_label} → ${offer.dest_label}`,
      `${dayLabel(offer.depart_at)} · ${formatTime(offer.depart_at)}`,
      `${formatMoney(offer.price_per_seat_cents, offer.currency)} / koltuk`,
      link,
    ].join('\n');
    try {
      await Share.share({ message, title: 'Trabzone yolculuk ilanı' });
    } catch {
      await Clipboard.setStringAsync(link);
      Alert.alert('Bağlantı kopyalandı', 'İlan bağlantısı panoya kopyalandı.');
    }
  };

  const handleSave = (event: GestureResponderEvent) => {
    event.stopPropagation();
    if (saved || saveFavorite.isPending) {
      return;
    }
    haptics.selection();
    saveFavorite.mutate(
      {
        label: `${offer.origin_label} → ${offer.dest_label}`,
        scope: offer.scope,
        originLabel: offer.origin_label,
        originCity: offer.origin_city,
        destLabel: offer.dest_label,
        destCity: offer.dest_city,
        alertEnabled: true,
      },
      {
        onSuccess: () => {
          setSaved(true);
          haptics.success();
        },
        onError: (cause) =>
          Alert.alert('Kaydedilemedi', errorMessage(cause, 'Güzergâh kaydedilemedi.')),
      },
    );
  };

  const primaryAction = () => {
    if (offer.my_reservation_id) {
      router.navigate(`/ride/trips/${offer.my_reservation_id}` as never);
      return;
    }
    openDetails();
  };

  const primaryLabel = offer.my_reservation_id
    ? 'Yolculuğa git'
    : isFull
      ? 'Bekleme listesi'
      : reservationStatus
        ? RESERVATION_STATUS_LABEL[reservationStatus] ?? 'Rezervasyon'
        : 'Koltuk talep et';

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${offer.origin_label} - ${offer.dest_label} yolculuğu, ${driverName}${
          vehicleName ? `, ${vehicleName}` : ''
        }, ${seatsAvailable} boş koltuk, ${formatMoney(offer.price_per_seat_cents, offer.currency)}`}
        accessibilityHint="İlan detayını açar"
        onPress={openDetails}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            opacity: pressed ? 0.94 : 1,
          },
          theme.shadows.card,
        ]}
      >
        <LinearGradient
          colors={[theme.colors.primarySoft, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.topGlow}
          pointerEvents="none"
        />

        {/* Üst bölüm: sürücü kimliği, puan, yayın zamanı ve canlı durum */}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${driverName} profilini aç`}
            onPress={openProfile}
            hitSlop={4}
            style={({ pressed }) => [styles.driver, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Avatar
              size={42}
              uri={mediaPublicUrl('avatar', offer.driver.avatar_path)}
              name={initials(offer.driver.first_name, offer.driver.username)}
              ring
            />
            <View style={styles.driverText}>
              <View style={styles.nameRow}>
                <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
                  {driverName}
                </AppText>
                {offer.driver.identity_verified || offer.driver.is_verified ? (
                  <VerifiedTick size={14} />
                ) : null}
              </View>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {publishedLine || driverHandle}
              </AppText>
            </View>
          </Pressable>

          <View
            style={[
              styles.statusChip,
              { backgroundColor: `${statusColor}16`, borderColor: `${statusColor}38` },
            ]}
          >
            <Ionicons name={status.icon} size={11} color={statusColor} />
            <AppText variant="caption" style={{ color: statusColor, fontWeight: '600' }} numberOfLines={1}>
              {isFull && offer.status !== 'started' ? 'Dolu' : status.label}
            </AppText>
          </View>
        </View>

        {/* Orta bölüm: premium rota hattı */}
        <View style={[styles.routeCard, { backgroundColor: theme.colors.surfaceMuted }]}>
          <View style={styles.routeRail}>
            <View style={[styles.routeDot, { backgroundColor: theme.colors.success }]} />
            <LinearGradient
              colors={[theme.colors.success, theme.colors.primary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.routeLine}
            />
            <View
              style={[
                styles.routeDot,
                styles.routeDotLarge,
                { backgroundColor: theme.colors.primary },
              ]}
            />
          </View>
          <View style={styles.routeBody}>
            <View style={styles.routeRow}>
              <AppText variant="bodyStrong" numberOfLines={1} style={styles.routeLabel}>
                {offer.origin_label}
              </AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {offer.origin_city}
              </AppText>
            </View>
            <View style={styles.routeRow}>
              <AppText variant="bodyStrong" numberOfLines={1} style={styles.routeLabel}>
                {offer.dest_label}
              </AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {offer.dest_city}
              </AppText>
            </View>
          </View>
          <View style={styles.routeTime}>
            <AppText variant="h3" color="primaryDeep">
              {formatTime(offer.depart_at)}
            </AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {dayLabel(offer.depart_at)}
            </AppText>
          </View>
        </View>

        {/* Kısa bilgi şeridi */}
        <View style={styles.metaRow}>
          {offer.duration_minutes ? (
            <View style={styles.metaChip}>
              <Ionicons name="time-outline" size={12} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textSecondary">
                {formatDuration(offer.duration_minutes)}
              </AppText>
            </View>
          ) : null}
          {offer.distance_meters ? (
            <View style={styles.metaChip}>
              <Ionicons name="speedometer-outline" size={12} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textSecondary">
                {formatDistance(offer.distance_meters)}
              </AppText>
            </View>
          ) : null}
          <View
            style={[
              styles.metaChip,
              {
                backgroundColor: isFull ? theme.colors.warningSoft : theme.colors.successSoft,
                borderColor: 'transparent',
              },
            ]}
          >
            <Ionicons
              name={isFull ? 'people-outline' : 'person-add-outline'}
              size={12}
              color={isFull ? theme.colors.warning : theme.colors.success}
            />
            <AppText
              variant="caption"
              style={{ color: isFull ? theme.colors.warning : theme.colors.success, fontWeight: '600' }}
            >
              {isFull ? 'Dolu' : `${seatsAvailable} boş koltuk`}
            </AppText>
          </View>
          {reservationStatus ? (
            <View
              style={[
                styles.metaChip,
                { backgroundColor: theme.colors.primarySoft, borderColor: 'transparent' },
              ]}
            >
              <Ionicons name="bookmark-outline" size={12} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep" numberOfLines={1}>
                {RESERVATION_STATUS_LABEL[reservationStatus] ?? reservationStatus}
              </AppText>
            </View>
          ) : null}
        </View>

        {/* Araç: fotoğraf tam ekran açılır */}
        <View style={[styles.vehicleRow, { borderColor: theme.colors.divider }]}>
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel={
              viewerItems.length
                ? `${vehicleName} araç fotoğrafını tam ekran aç`
                : 'Araç fotoğrafı yok'
            }
            disabled={!viewerItems.length}
            onPress={openViewer}
            style={({ pressed }) => [
              styles.vehicleThumb,
              {
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surfaceMuted,
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            {coverPhoto && !photoError ? (
              <AppImage
                source={{ uri: coverPhoto }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                recycleKey={`${offer.id}:vehicle`}
                accessibilityIgnoresInvertColors
                onError={() => setPhotoError(true)}
              />
            ) : (
              <View style={styles.vehicleFallback}>
                <Ionicons name="car-sport" size={24} color={theme.colors.primaryDeep} />
              </View>
            )}
            {viewerItems.length ? (
              <>
                <LinearGradient
                  colors={['transparent', 'rgba(4,8,18,0.62)']}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                <View style={styles.photoCount}>
                  <Ionicons name="images-outline" size={10} color="#FFFFFF" />
                  <AppText variant="caption" style={styles.photoCountText}>
                    {viewerItems.length}
                  </AppText>
                </View>
                <View style={styles.expandIcon}>
                  <Ionicons name="expand-outline" size={11} color="#FFFFFF" />
                </View>
              </>
            ) : null}
          </Pressable>

          <View style={styles.vehicleBody}>
            <View style={styles.vehicleTitleRow}>
              <AppText variant="label" numberOfLines={1} style={styles.vehicleTitle}>
                {vehicleName || 'Araç bilgisi'}
              </AppText>
              {offer.vehicle.verified ? (
                <View style={[styles.verifiedChip, { backgroundColor: theme.colors.successSoft }]}>
                  <Ionicons name="shield-checkmark" size={10} color={theme.colors.success} />
                  <AppText variant="caption" style={{ color: theme.colors.success, fontSize: 9 }}>
                    Doğrulanmış
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              {vehicleMeta || `${offer.seats_total} koltuklu araç`}
            </AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {offer.vehicle.year ? `${offer.vehicle.year} model` : ''}
              {offer.vehicle.plate ? ` · ${offer.vehicle.plate}` : ''}
            </AppText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="İlan detayını gör"
            onPress={(event) => {
              event.stopPropagation();
              openDetails();
            }}
            style={[styles.chevron, { backgroundColor: theme.colors.surfaceMuted }]}
          >
            <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
          </Pressable>
        </View>

        {/* Alt bölüm: fiyat ve eylemler */}
        <View style={styles.footer}>
          <View style={styles.priceBlock}>
            <AppText variant="h3" color="primaryDeep" numberOfLines={1}>
              {formatMoney(offer.price_per_seat_cents, offer.currency)}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              koltuk başı
            </AppText>
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={saved ? 'Güzergâh kaydedildi' : 'Güzergâhı kaydet'}
              onPress={handleSave}
              disabled={saved || saveFavorite.isPending}
              hitSlop={4}
              style={({ pressed }) => [
                styles.iconBtn,
                {
                  borderColor: theme.colors.border,
                  backgroundColor: saved ? theme.colors.successSoft : theme.colors.surfaceMuted,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons
                name={saved ? 'bookmark' : 'bookmark-outline'}
                size={16}
                color={saved ? theme.colors.success : theme.colors.textSecondary}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="İlanı paylaş"
              onPress={handleShare}
              hitSlop={4}
              style={({ pressed }) => [
                styles.iconBtn,
                {
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceMuted,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="share-social-outline" size={16} color={theme.colors.textSecondary} />
            </Pressable>
            <Button
              label={primaryLabel}
              size="sm"
              fullWidth={false}
              onPress={(event) => {
                event.stopPropagation();
                primaryAction();
              }}
              style={styles.cta}
              leftIcon={
                <Ionicons
                  name={
                    offer.my_reservation_id
                      ? 'navigate'
                      : isFull
                        ? 'hourglass-outline'
                        : 'add-circle-outline'
                  }
                  size={15}
                  color="#FFFFFF"
                />
              }
            />
          </View>
        </View>
      </Pressable>

      {profileOpen ? (
        <Modal
          transparent
          visible
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setProfileOpen(false)}
        >
          <View style={StyleSheet.absoluteFill}>
            <ProfilePreviewSheet
              key={offer.driver.id}
              visible
              userId={offer.driver.id}
              username={offer.driver.username ?? null}
              onClose={() => setProfileOpen(false)}
              onViewProfile={(username) => {
                setProfileOpen(false);
                router.push(`/profile/${username}` as never);
              }}
              onOpenChat={(conversationId) => {
                setProfileOpen(false);
                router.push(`/chat/${conversationId}` as never);
              }}
            />
          </View>
        </Modal>
      ) : null}

      {viewerOpen && viewerItems.length ? (
        <MarketMediaViewer
          visible
          items={viewerItems}
          initialIndex={viewerIndex}
          onClose={() => setViewerOpen(false)}
          onIndexChange={setViewerIndex}
        />
      ) : null}
    </>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    gap: 11,
    overflow: 'hidden',
  },
  topGlow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 92,
    opacity: 0.55,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  driver: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, minWidth: 0 },
  driverText: { flex: 1, minWidth: 0, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 132,
  },
  routeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 15,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  routeRail: { alignItems: 'center', alignSelf: 'stretch', width: 14, paddingVertical: 4 },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeDotLarge: { width: 10, height: 10, borderRadius: 5 },
  routeLine: { flex: 1, width: 2, marginVertical: 3, borderRadius: 1, minHeight: 16 },
  routeBody: { flex: 1, gap: 8, minWidth: 0 },
  routeRow: { gap: 0 },
  routeLabel: { flexShrink: 1 },
  routeTime: { alignItems: 'flex-end', gap: 0, minWidth: 54 },
  metaRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  vehicleThumb: {
    width: 82,
    height: 58,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  vehicleFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  photoCount: {
    position: 'absolute',
    left: 5,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(4,8,18,0.5)',
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  photoCountText: { color: '#FFFFFF', fontSize: 9 },
  expandIcon: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 18,
    height: 18,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4,8,18,0.48)',
  },
  vehicleBody: { flex: 1, minWidth: 0, gap: 1 },
  vehicleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  vehicleTitle: { flexShrink: 1 },
  verifiedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 999,
  },
  chevron: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priceBlock: { minWidth: 70, gap: 0 },
  actions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cta: { minWidth: 112, paddingHorizontal: 12 },
});
