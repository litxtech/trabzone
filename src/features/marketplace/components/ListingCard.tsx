import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { publicMediaUrl } from '@/features/media/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import {
  CONDITION_LABELS,
  formatPrice,
  type Listing,
} from '../services/marketplace-service';

export type ListingCardProps = {
  listing: Listing;
  variant?: 'grid' | 'row';
  onPress: () => void;
  onToggleFavorite?: () => void;
  favoritePending?: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Satışta',
  reserved: 'Rezerve',
  sold: 'Satıldı',
  archived: 'Arşivde',
  removed: 'Kaldırıldı',
};

export function ListingCard({
  listing,
  variant = 'grid',
  onPress,
  onToggleFavorite,
  favoritePending = false,
}: ListingCardProps) {
  const { theme } = useTheme();
  const image = publicMediaUrl('listing-images', listing.images[0]?.storage_path);
  const unavailable = listing.status !== 'active';
  const isGrid = variant === 'grid';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${formatPrice(listing.price_cents, listing.currency)}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        isGrid ? styles.grid : styles.row,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: isGrid ? 18 : 16,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[isGrid ? styles.gridImageWrap : styles.rowImageWrap, { backgroundColor: theme.colors.surfaceMuted }]}>
        {image ? (
          <Image
            source={{ uri: image }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={160}
            cachePolicy="memory-disk"
            recyclingKey={listing.id}
          />
        ) : (
          <View style={styles.imageFallback}>
            <Ionicons name="image-outline" size={22} color={theme.colors.textTertiary} />
          </View>
        )}

        {unavailable || listing.status === 'reserved' ? (
          <View style={[styles.statusBadge, { backgroundColor: theme.colors.overlay }]}>
            <AppText variant="caption" color="#FFFFFF">
              {STATUS_LABELS[listing.status] ?? listing.status}
            </AppText>
          </View>
        ) : null}

        {onToggleFavorite ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={listing.is_favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
            accessibilityState={{ selected: listing.is_favorite, busy: favoritePending }}
            disabled={favoritePending}
            hitSlop={8}
            onPress={() => {
              haptics.selection();
              onToggleFavorite();
            }}
            style={({ pressed }) => [
              styles.favorite,
              {
                backgroundColor: theme.colors.surface,
                opacity: favoritePending ? 0.5 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons
              name={listing.is_favorite ? 'heart' : 'heart-outline'}
              size={16}
              color={listing.is_favorite ? theme.colors.danger : theme.colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.body, isGrid ? null : styles.rowBody]}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {listing.title}
        </AppText>

        <AppText variant="label" color="primaryDeep" numberOfLines={1}>
          {formatPrice(listing.price_cents, listing.currency)}
        </AppText>

        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={11} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
            {listing.city ?? 'Konum belirtilmedi'}
            {isGrid ? '' : ` · ${CONDITION_LABELS[listing.condition]}`}
          </AppText>
        </View>

        {isGrid ? null : (
          <View style={styles.metaRow}>
            <Ionicons name="person-outline" size={11} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
              @{listing.seller_username}
              {listing.seller_verified ? ' · Doğrulanmış' : ''}
            </AppText>
          </View>
        )}
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
  row: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  gridImageWrap: { width: '100%', aspectRatio: 1.08 },
  rowImageWrap: { width: 104, height: 104 },
  imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statusBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  favorite: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: 10, gap: 3 },
  rowBody: { flex: 1, justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  flex: { flex: 1 },
});
