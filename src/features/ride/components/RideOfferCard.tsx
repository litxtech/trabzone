import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { useRouter } from '@/utils/router';
import { AppImage, AppText, Avatar } from '@/components/ui';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';

import { rideVehiclePhotoUrl } from '../services/ride-service';
import type { RideSearchItem } from '../types';
import {
  dayLabel,
  formatMoney,
  formatTime,
  initials,
} from '../utils/format';
import { RideRouteBlock } from './RideBits';
import { VerifiedTick } from './IdentityBadge';

/**
 * Arama ve ana sayfa listelerinde kullanılan ilan kartı.
 *
 * Kart artık ilanı paylaşan kişiyi ve aracını birlikte gösterir: sürücü
 * avatarı, adı ve aracın fotoğrafı aynı altbilgide durur. Cam yüzey, yarı
 * saydam zemin ve ince kenarla oluşturulur; okunabilirlik için metinler
 * tema renklerini kullanmaya devam eder.
 */
export function RideOfferCard({ offer }: { offer: RideSearchItem }) {
  const { theme } = useTheme();
  const router = useRouter();
  const driverName =
    [offer.driver.first_name, offer.driver.username].filter(Boolean).join(' ') || 'Sürücü';
  const score = offer.match?.score;
  const vehiclePhotos = (offer.vehicle.photo_paths ?? [])
    .map((path) => rideVehiclePhotoUrl(path))
    .filter((url): url is string => Boolean(url))
    .slice(0, 2);
  const vehicleName = [offer.vehicle.make, offer.vehicle.model].filter(Boolean).join(' ');

  const metaLine = [
    typeof score === 'number' ? `%${Math.round(score)} eşleşme` : null,
    offer.driver.rating_avg ? `${offer.driver.rating_avg.toFixed(1)} ★` : null,
    `${offer.driver.completed_trips ?? 0} yolculuk`,
  ]
    .filter(Boolean)
    .join(' · ');

  const vehicleLine = [`${offer.seats_available} boş`, vehicleName]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${offer.origin_label} - ${offer.dest_label} yolculuğu, ${driverName}${
        vehicleName ? `, ${vehicleName}` : ''
      }`}
      onPress={() => router.navigate(`/ride/offers/${offer.id}` as never)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.glass,
          borderColor: theme.colors.glassBorder,
          borderTopColor: theme.colors.glassHighlight,
          opacity: pressed ? 0.88 : 1,
        },
        theme.shadows.card,
      ]}
    >
      <View style={styles.top}>
        <View style={styles.timeBlock}>
          <AppText variant="h3">{formatTime(offer.depart_at)}</AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {dayLabel(offer.depart_at)}
          </AppText>
        </View>
        <View style={[styles.verticalDivider, { backgroundColor: theme.colors.divider }]} />
        <View style={styles.flex}>
          <RideRouteBlock origin={offer.origin_label} dest={offer.dest_label} />
        </View>
        <View style={styles.priceBlock}>
          <AppText variant="title" color="primaryDeep" numberOfLines={1}>
            {formatMoney(offer.price_per_seat_cents, offer.currency)}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            koltuk başı
          </AppText>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />

      <View style={styles.footer}>
        <Avatar
          size={36}
          uri={mediaPublicUrl('avatar', offer.driver.avatar_path)}
          name={initials(offer.driver.first_name, offer.driver.username)}
        />
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <AppText variant="label" numberOfLines={1} style={styles.name}>
              {driverName}
            </AppText>
            {offer.driver.identity_verified ? <VerifiedTick size={14} /> : null}
          </View>
          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
            {metaLine}
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {vehicleLine}
          </AppText>
        </View>
        <View
          style={[
            styles.vehicleMedia,
            {
              backgroundColor: theme.colors.surfaceMuted,
              borderColor: theme.colors.glassBorder,
            },
          ]}
        >
          {vehiclePhotos.length > 0 ? (
            vehiclePhotos.map((uri) => (
              <AppImage
                key={uri}
                source={{ uri }}
                style={styles.vehicleImage}
                contentFit="cover"
                recycleKey={`${offer.id}:${uri}`}
                accessibilityIgnoresInvertColors
              />
            ))
          ) : (
            <View style={styles.vehiclePlaceholder}>
              <Ionicons name="car-sport-outline" size={22} color={theme.colors.textTertiary} />
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  timeBlock: { width: 54, gap: 0 },
  verticalDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  flex: { flex: 1, minWidth: 0 },
  priceBlock: { alignItems: 'flex-end', minWidth: 72 },
  divider: { height: StyleSheet.hairlineWidth },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1 },
  vehicleMedia: {
    width: 82,
    height: 62,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  vehicleImage: { flex: 1, height: '100%' },
  vehiclePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
