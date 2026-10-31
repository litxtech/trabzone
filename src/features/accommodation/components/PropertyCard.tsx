import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppImage, AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { accommodationMediaUrl } from '../services/accommodation-media-service';
import type { PropertySummary } from '../types';
import { formatMoneyCents, PROPERTY_TYPE_LABELS } from '../utils/format';
import { AmenityChips, GlassPill, ratingLabel } from './PremiumUI';

/**
 * Keşfet vitrininindeki tesis kartı.
 * Görsel oranı korunur, üzerine cam etiketler biner; alt bölümde ad, puan,
 * olanak özeti ve gecelik fiyat bulunur.
 *
 * `memo` + kimlik tabanlı `onPress`: vitrin ızgarası 40 karta kadar çıkıyor.
 * Her tuş vuruşunda/filtre değişiminde aynı nesneler yeniden çizilmesin diye
 * kart yalnızca kendi verisi değiştiğinde render edilir.
 */
export const PropertyCard = memo(function PropertyCard({
  property,
  onPress,
}: {
  property: PropertySummary;
  onPress: (propertyId: string) => void;
}) {
  const { theme } = useTheme();
  const photos = property.photos.length > 0 ? property.photos : property.cover_path ? [property.cover_path] : [];
  const cover = accommodationMediaUrl(photos[0]);
  const location = [property.neighborhood, property.district].filter(Boolean).join(', ') || 'Trabzon';
  const extraPhotos = Math.max(0, property.photo_count - 1);
  const instant = property.booking_modes.includes('instant');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${property.name}, ${PROPERTY_TYPE_LABELS[property.property_type]}, ${location}`}
      onPress={() => onPress(property.id)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.xl,
          transform: [{ scale: pressed ? 0.99 : 1 }],
          opacity: pressed ? 0.96 : 1,
        },
        theme.shadows.card,
      ]}
    >
      <View style={styles.media}>
        {cover ? (
          <AppImage source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" recycleKey={property.id} />
        ) : (
          <LinearGradient
            colors={[theme.colors.primarySoft, theme.colors.surfaceMuted]}
            style={[StyleSheet.absoluteFill, styles.fallback]}
          >
            <Ionicons name="bed-outline" size={30} color={theme.colors.primaryDeep} />
          </LinearGradient>
        )}
        <LinearGradient
          colors={['rgba(6,10,20,0.05)', 'rgba(6,10,20,0.15)', 'rgba(6,10,20,0.72)']}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <View style={styles.topRow}>
          <GlassPill icon="bed-outline" label={PROPERTY_TYPE_LABELS[property.property_type]} />
          <View style={styles.topRight}>
            {property.has_deal ? (
              <View style={[styles.dealRibbon, { backgroundColor: theme.colors.accent }]}>
                <Ionicons name="pricetag" size={10} color="#FFFFFF" />
                <AppText variant="caption" style={styles.dealText}>
                  Fırsat
                </AppText>
              </View>
            ) : null}
            {property.rating_count > 0 ? (
              <View style={styles.ratingChip}>
                <Ionicons name="star" size={11} color="#F5B301" />
                <AppText variant="caption" style={styles.ratingChipText}>
                  {property.rating_avg.toFixed(1)}
                </AppText>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.bottomRow}>
          <View style={styles.locationRow}>
            <Ionicons name="location" size={12} color="rgba(255,255,255,0.92)" />
            <AppText variant="caption" numberOfLines={1} style={styles.locationText}>
              {location}
            </AppText>
          </View>
          {extraPhotos > 0 ? (
            <View style={styles.photoCount}>
              <Ionicons name="images-outline" size={11} color="#FFFFFF" />
              <AppText variant="caption" style={styles.photoCountText}>
                {extraPhotos + 1}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <AppText variant="title" numberOfLines={1} style={styles.flex}>
            {property.name}
          </AppText>
          {property.my_reservation_count > 0 ? (
            <View style={[styles.tripBadge, { backgroundColor: theme.colors.successSoft }]}>
              <Ionicons name="checkmark-circle" size={11} color={theme.colors.success} />
              <AppText variant="caption" color="success" style={styles.tripBadgeText}>
                {property.my_reservation_count} rezervasyon
              </AppText>
            </View>
          ) : null}
        </View>

        {property.description ? (
          <AppText variant="caption" color="textSecondary" numberOfLines={2} style={styles.description}>
            {property.description}
          </AppText>
        ) : null}

        <AmenityChips items={property.amenities} max={3} />

        <View style={[styles.footer, { borderTopColor: theme.colors.divider }]}>
          <View style={styles.priceCol}>
            <AppText variant="caption" color="textTertiary" style={styles.priceCaption}>
              {property.price_from_cents ? 'gecelik başlangıç' : 'fiyat için iletişim'}
            </AppText>
            {property.price_from_cents ? (
              <AppText variant="h3" color="primaryDeep" style={styles.price}>
                {formatMoneyCents(property.price_from_cents, property.currency, { decimals: false })}
              </AppText>
            ) : (
              <AppText variant="bodyStrong" color="textSecondary">
                Bilgi al
              </AppText>
            )}
          </View>

          <View style={styles.footerRight}>
            {instant ? (
              <View style={[styles.instant, { backgroundColor: theme.colors.successSoft }]}>
                <Ionicons name="flash" size={10} color={theme.colors.success} />
                <AppText variant="caption" color="success" style={styles.instantText}>
                  Anında onay
                </AppText>
              </View>
            ) : (
              <View style={[styles.instant, { backgroundColor: theme.colors.warningSoft }]}>
                <Ionicons name="time-outline" size={10} color={theme.colors.warning} />
                <AppText variant="caption" color="warning" style={styles.instantText}>
                  Onaylı
                </AppText>
              </View>
            )}
            <View style={[styles.cta, { backgroundColor: theme.colors.primaryDeep }]}>
              <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
            </View>
          </View>
        </View>

        {property.rating_count > 0 ? (
          <AppText variant="caption" color="textTertiary" style={styles.ratingHint}>
            {ratingLabel(property.rating_avg, property.rating_count)} · {property.rating_count} misafir yorumu
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
});

export function PropertyCardSkeleton() {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.xl,
        },
      ]}
    >
      <View style={[styles.media, { backgroundColor: theme.colors.skeleton }]} />
      <View style={styles.skeletonBody}>
        <View style={[styles.skeletonLine, { backgroundColor: theme.colors.skeleton, width: '68%', height: 15 }]} />
        <View style={[styles.skeletonLine, { backgroundColor: theme.colors.skeleton, width: '90%' }]} />
        <View style={[styles.skeletonLine, { backgroundColor: theme.colors.skeleton, width: '42%' }]} />
        <View style={styles.skeletonFoot}>
          <View style={[styles.skeletonLine, { backgroundColor: theme.colors.skeleton, width: 90, height: 20 }]} />
          <View style={[styles.skeletonLine, { backgroundColor: theme.colors.skeleton, width: 74, height: 30 }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  media: { height: 196, position: 'relative', backgroundColor: '#101828' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  topRow: {
    position: 'absolute',
    top: 11,
    left: 11,
    right: 11,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto' },
  dealRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
  },
  dealText: { color: '#FFFFFF', fontSize: 9 },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(8,13,26,0.6)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  ratingChipText: { color: '#FFFFFF', fontSize: 10 },
  bottomRow: {
    position: 'absolute',
    left: 11,
    right: 11,
    bottom: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 },
  locationText: { color: '#FFFFFF', fontSize: 11 },
  photoCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(8,13,26,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  photoCountText: { color: '#FFFFFF', fontSize: 10 },
  body: { padding: 13, gap: 7 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tripBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  tripBadgeText: { fontSize: 9 },
  description: { lineHeight: 17 },
  footer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  priceCol: { flex: 1, gap: 1 },
  priceCaption: { fontSize: 10 },
  price: { fontVariant: ['tabular-nums'] },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  instant: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 7 },
  instantText: { fontSize: 9 },
  cta: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  ratingHint: { fontSize: 10 },
  skeletonBody: { padding: 13, gap: 8 },
  skeletonLine: { height: 12, borderRadius: 6 },
  skeletonFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
});
