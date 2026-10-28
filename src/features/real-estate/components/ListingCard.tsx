import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge } from '@/components/ui';
import { StorageImage } from '@/features/explore/components/StorageImage';
import type { RealEstateListing } from '@/features/explore/types';
import { formatPrice, listingKindLabel, metersLabel, roomLabel } from '@/features/explore/utils/format';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

type Props = {
  listing: RealEstateListing;
  width?: number;
  compact?: boolean;
  onPress: () => void;
  onToggleFavorite?: () => void;
};

/** Emlak ilanı kartı. Fiyat, konum ve doğrulama durumu gerçek yanıttan gelir. */
export function ListingCard({ listing, width, compact = false, onPress, onToggleFavorite }: Props) {
  const { theme } = useTheme();
  const specs = [
    listing.net_m2 ?? listing.gross_m2 ? `${listing.net_m2 ?? listing.gross_m2} m²` : null,
    listing.room_count ? roomLabel(listing.room_count) : null,
  ].filter(Boolean) as string[];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${formatPrice(listing.price_cents, listing.currency, listing.price_period)}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.card,
        theme.shadows.card,
        {
          width: width ?? '100%',
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.92 : 1,
        },
        compact ? styles.compact : null,
      ]}
    >
      <View style={[styles.media, compact ? styles.mediaCompact : null]}>
        <StorageImage
          path={listing.cover_path}
          bucket="real-estate-media"
          style={StyleSheet.absoluteFill}
          recycleKey={listing.id}
        />
        {!listing.cover_path ? (
          <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons name="home-outline" size={26} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary">
              Fotoğraf yok
            </AppText>
          </View>
        ) : null}

        <LinearGradient colors={['rgba(4,8,18,0.06)', 'rgba(4,8,18,0.62)']} style={StyleSheet.absoluteFill} />

        <View style={styles.topRow}>
          <Badge label={listingKindLabel(listing.listing_kind)} tone="primary" />
          {onToggleFavorite ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={listing.is_favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
              hitSlop={8}
              onPress={(event) => {
                event.stopPropagation();
                haptics.tap();
                onToggleFavorite();
              }}
              style={styles.favorite}
            >
              <Ionicons
                name={listing.is_favorite ? 'heart' : 'heart-outline'}
                size={17}
                color={listing.is_favorite ? '#FF6B8A' : '#FFFFFF'}
              />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.priceWrap}>
          <AppText variant="bodyStrong" color="#FFFFFF" numberOfLines={1}>
            {formatPrice(listing.price_cents, listing.currency, listing.price_period)}
          </AppText>
          {listing.verification_status === 'verified' ? (
            <View style={styles.verified}>
              <Ionicons name="shield-checkmark" size={11} color="#4ADE80" />
              <AppText variant="caption" color="#4ADE80">
                EİDS
              </AppText>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.body}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {listing.title}
        </AppText>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={13} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.flex}>
            {[listing.district, listing.neighborhood].filter(Boolean).join(', ') || 'Konum belirtilmedi'}
          </AppText>
        </View>
        {specs.length > 0 ? (
          <View style={styles.specs}>
            {specs.map((spec) => (
              <View key={spec} style={[styles.spec, { backgroundColor: theme.colors.surfaceMuted }]}>
                <AppText variant="caption" color="textSecondary">
                  {spec}
                </AppText>
              </View>
            ))}
            {listing.category_name ? (
              <View style={[styles.spec, { backgroundColor: theme.colors.primarySoft }]}>
                <AppText variant="caption" color="primaryDeep" numberOfLines={1}>
                  {listing.category_name}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Listede kullanılan yatay satır varyantı. */
export function ListingRow({ listing, onPress }: { listing: RealEstateListing; onPress: () => void }) {
  return <ListingCard listing={listing} compact onPress={onPress} />;
}

export function listingSpecs(listing: RealEstateListing): string[] {
  return [
    metersLabel(listing.net_m2 ?? listing.gross_m2),
    listing.room_count ? roomLabel(listing.room_count) : null,
  ].filter((value): value is string => Boolean(value) && value !== '—');
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  compact: { width: 250 },
  media: { height: 158, backgroundColor: '#0B1220' },
  mediaCompact: { height: 140 },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: 5 },
  topRow: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  favorite: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(9,14,28,0.45)',
  },
  priceWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  body: { padding: 12, gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  specs: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2 },
  spec: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, maxWidth: 130 },
  flex: { flex: 1 },
});
