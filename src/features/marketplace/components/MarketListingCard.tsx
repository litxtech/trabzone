import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppImage, AppText } from '@/components/ui';
import { publicMediaUrl } from '@/features/media/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import {
  CONDITION_LABELS,
  formatMarketPrice,
  formatRelativeDate,
  locationLabel,
  primaryAttribute,
  STATUS_LABELS,
  type MarketListing,
} from '../services/marketplace-catalog-service';

export type MarketListingCardProps = {
  listing: MarketListing;
  layout?: 'grid' | 'feature' | 'row';
  width?: number;
  onPress: () => void;
  onToggleFavorite?: () => void;
  favoritePending?: boolean;
  showStatus?: boolean;
  showSeller?: boolean;
};

/** Tüm Marketplace kategorilerinde kullanılan premium ilan kartı. */
export function MarketListingCard({
  listing,
  layout = 'grid',
  width,
  onPress,
  onToggleFavorite,
  favoritePending = false,
  showStatus = false,
  showSeller = false,
}: MarketListingCardProps) {
  const { theme } = useTheme();
  const imageUri = publicMediaUrl(
    'listing-images',
    listing.cover_thumb_path ?? listing.cover_path,
  );
  const isGrid = layout === 'grid';
  const isFeature = layout === 'feature';
  const unavailable = listing.status !== 'active';
  const area = primaryAttribute(listing.attributes, ['m2', 'brut_m2', 'net_m2', 'alan']);
  const rooms = primaryAttribute(listing.attributes, ['rooms', 'oda_sayisi', 'oda']);
  const vehicleYear = primaryAttribute(listing.attributes, ['year', 'yil', 'model_yili']);
  const km = primaryAttribute(listing.attributes, ['km', 'kilometre']);
  const detailChip =
    area != null
      ? `${area} m²${rooms ? ` · ${rooms}` : ''}`
      : vehicleYear != null
        ? `${vehicleYear}${km ? ` · ${km} km` : ''}`
        : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${formatMarketPrice(
        listing.price_cents,
        listing.currency,
        listing.price_period,
      )}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        isGrid ? styles.grid : isFeature ? styles.feature : styles.row,
        width != null ? { width } : null,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: 18,
          opacity: pressed ? 0.88 : 1,
          transform: [{ scale: pressed ? 0.992 : 1 }],
        },
      ]}
    >
      <View
        style={[
          isGrid ? styles.gridMedia : isFeature ? styles.featureMedia : styles.rowMedia,
          { backgroundColor: theme.colors.surfaceMuted },
        ]}
      >
        {imageUri ? (
          <AppImage
            source={{ uri: imageUri }}
            style={StyleSheet.absoluteFill}
            recycleKey={listing.id}
          />
        ) : (
          <View style={styles.imageFallback}>
            <Ionicons name="image-outline" size={24} color={theme.colors.textTertiary} />
          </View>
        )}

        {showStatus && unavailable ? (
          <View style={[styles.statusBadge, { backgroundColor: theme.colors.overlay }]}>
            <AppText variant="caption" color="#FFFFFF">
              {STATUS_LABELS[listing.status] ?? listing.status}
            </AppText>
          </View>
        ) : listing.condition === 'new' ? (
          <View style={[styles.statusBadge, { backgroundColor: 'rgba(4,10,22,0.62)' }]}>
            <AppText variant="caption" color="#FFFFFF">
              Sıfır
            </AppText>
          </View>
        ) : null}

        {listing.verification_status === 'pending' ? (
          <View style={styles.verifyBadge}>
            <Ionicons name="shield-checkmark-outline" size={10} color="#FFFFFF" />
            <AppText variant="caption" color="#FFFFFF">
              Onay bekliyor
            </AppText>
          </View>
        ) : null}

        {onToggleFavorite ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={listing.is_favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
            accessibilityState={{ selected: listing.is_favorite, busy: favoritePending }}
            disabled={favoritePending}
            hitSlop={10}
            onPress={() => {
              haptics.selection();
              onToggleFavorite();
            }}
            style={({ pressed }) => [
              styles.favorite,
              {
                backgroundColor: 'rgba(8,14,26,0.42)',
                opacity: favoritePending ? 0.45 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons
              name={listing.is_favorite ? 'heart' : 'heart-outline'}
              size={17}
              color={listing.is_favorite ? theme.colors.danger : '#FFFFFF'}
            />
          </Pressable>
        ) : null}

        {listing.video_count > 0 ? (
          <View style={styles.videoBadge}>
            <Ionicons name="play" size={10} color="#FFFFFF" />
            <AppText variant="caption" color="#FFFFFF">
              {listing.video_count > 1 ? listing.video_count : 'Video'}
            </AppText>
          </View>
        ) : null}

        {detailChip ? (
          <View style={styles.detailChip}>
            <AppText variant="caption" color="#FFFFFF" numberOfLines={1}>
              {detailChip}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={[styles.body, isGrid ? null : styles.wideBody]}>
        <AppText variant="bodyStrong" numberOfLines={isGrid ? 2 : 2}>
          {listing.title}
        </AppText>

        <View style={styles.priceRow}>
          <AppText
            variant={isGrid ? 'title' : 'h3'}
            color="primaryDeep"
            numberOfLines={1}
            style={styles.price}
          >
            {formatMarketPrice(listing.price_cents, listing.currency, listing.price_period)}
          </AppText>
          {listing.price_period === 'total' && listing.category_kind === 'real_estate' ? (
            <AppText variant="caption" color="textTertiary">
              {listing.attributes.listing_kind === 'rent' ? 'Kiralık' : 'Satılık'}
            </AppText>
          ) : null}
        </View>

        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={11} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
            {locationLabel(listing)}
          </AppText>
        </View>

        <View style={styles.metaRow}>
          <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
            {formatRelativeDate(listing.published_at ?? listing.created_at)}
            {isGrid && !showSeller ? ` · ${CONDITION_LABELS[listing.condition] ?? ''}` : ''}
          </AppText>
          {showSeller && listing.seller_username ? (
            <View style={styles.sellerRow}>
              <Ionicons
                name={listing.seller_verified ? 'shield-checkmark' : 'person-outline'}
                size={10}
                color={listing.seller_verified ? theme.colors.success : theme.colors.textTertiary}
              />
              <AppText
                variant="caption"
                color={listing.seller_verified ? 'success' : 'textTertiary'}
                numberOfLines={1}
              >
                @{listing.seller_username}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  feature: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  gridMedia: { width: '100%', aspectRatio: 1.14 },
  featureMedia: { width: '100%', aspectRatio: 1.55 },
  rowMedia: { width: 116, minHeight: 124 },
  imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statusBadge: {
    position: 'absolute',
    left: 8,
    top: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  verifyBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(128,87,244,0.88)',
  },
  favorite: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(8,14,26,0.55)',
  },
  detailChip: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: '58%',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(8,14,26,0.55)',
  },
  body: { padding: 11, gap: 4 },
  wideBody: { flex: 1, justifyContent: 'center', padding: 12, gap: 3 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  price: { flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 15 },
  flex: { flex: 1 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '52%' },
});
