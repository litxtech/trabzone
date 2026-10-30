import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar } from '@/components/ui';
import { StorageImage } from '@/features/explore/components/StorageImage';
import type { RealEstateListing } from '@/features/explore/types';
import { formatPrice, metersLabel, roomLabel } from '@/features/explore/utils/format';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { listingKindLabel, ownerTypeLabel } from '@/features/real-estate/labels';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

type Props = {
  listing: RealEstateListing;
  width?: number;
  compact?: boolean;
  onPress: () => void;
  onToggleFavorite?: () => void;
};

/**
 * Emlak ilanı kartı.
 *
 * Okuma sırası tek: fiyat → başlık → konum → özet → ilan sahibi. Kapak
 * görseli birden fazla fotoğraf varsa üçlü kolaja dönüşür; böylece kart
 * yüksekliği artmadan ilanın diğer kareleri de görünür. Alt satırdaki
 * avatar, ilanı paylaşan kişiyi tanıtır.
 */
export function ListingCard({ listing, width, compact = false, onPress, onToggleFavorite }: Props) {
  const { theme } = useTheme();
  const area = listing.net_m2 ?? listing.gross_m2;
  const specs = [
    area != null ? metersLabel(area) : null,
    listing.room_count ? roomLabel(listing.room_count) : null,
    listing.building_age != null ? `${listing.building_age} yaşında` : null,
  ].filter(Boolean) as string[];
  const location =
    [listing.district, listing.neighborhood].filter(Boolean).join(', ') || 'Konum belirtilmedi';
  const gallery = (
    listing.photos?.length
      ? listing.photos
      : listing.cover_path
        ? [listing.cover_path]
        : []
  ).slice(0, 3);
  const photoCount = listing.photo_count ?? listing.photos?.length ?? gallery.length;
  const ownerName =
    listing.owner?.display_name?.trim() || listing.owner?.username || 'İlan sahibi';
  const ownerDetail = listing.owner ? ownerTypeLabel(listing.owner_type) : 'İlan sahibi';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${formatPrice(listing.price_cents, listing.currency, listing.price_period)}, ${ownerName}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.card,
        {
          width: width ?? '100%',
          backgroundColor: theme.colors.glass,
          borderColor: theme.colors.glassBorder,
          borderTopColor: theme.colors.glassHighlight,
          opacity: pressed ? 0.9 : 1,
        },
        theme.shadows.card,
        compact ? styles.compact : null,
      ]}
    >
      <View style={[styles.media, compact ? styles.mediaCompact : null]}>
        {gallery.length > 1 ? (
          <View style={styles.gallery}>
            <StorageImage
              path={gallery[0]}
              bucket="real-estate-media"
              style={styles.galleryMain}
              recycleKey={`${listing.id}:0`}
            />
            <View style={styles.gallerySide}>
              <StorageImage
                path={gallery[1]}
                bucket="real-estate-media"
                style={styles.gallerySideImage}
                recycleKey={`${listing.id}:1`}
              />
              {gallery[2] ? (
                <StorageImage
                  path={gallery[2]}
                  bucket="real-estate-media"
                  style={styles.gallerySideImage}
                  recycleKey={`${listing.id}:2`}
                />
              ) : null}
            </View>
          </View>
        ) : gallery.length === 1 ? (
          <StorageImage
            path={gallery[0]}
            bucket="real-estate-media"
            style={StyleSheet.absoluteFill}
            recycleKey={listing.id}
          />
        ) : (
          <View
            style={[
              StyleSheet.absoluteFill,
              styles.placeholder,
              { backgroundColor: theme.colors.surfaceMuted },
            ]}
          >
            <Ionicons name="home-outline" size={22} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary">
              Fotoğraf yok
            </AppText>
          </View>
        )}

        <View style={styles.overlayTop}>
          <View style={styles.kindPill}>
            <AppText variant="caption" color="#0B1220" style={styles.kindText}>
              {listingKindLabel(listing.listing_kind)}
            </AppText>
          </View>
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
                size={16}
                color={listing.is_favorite ? '#E11D48' : '#0B1220'}
              />
            </Pressable>
          ) : null}
        </View>

        {listing.verification_status === 'verified' ? (
          <View style={styles.verified}>
            <Ionicons name="shield-checkmark" size={11} color="#4ADE80" />
            <AppText variant="caption" color="#E8FFF3">
              EİDS
            </AppText>
          </View>
        ) : null}

        {photoCount > 1 ? (
          <View style={styles.photoCount}>
            <Ionicons name="images-outline" size={11} color="#FFFFFF" />
            <AppText variant="caption" color="#FFFFFF">
              {photoCount}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <AppText variant="h3" color="primaryDeep" numberOfLines={1}>
          {formatPrice(listing.price_cents, listing.currency, listing.price_period)}
        </AppText>
        <AppText variant="body" numberOfLines={2} style={styles.title}>
          {listing.title}
        </AppText>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={12} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
            {location}
          </AppText>
        </View>
        {specs.length > 0 ? (
          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
            {specs.join(' · ')}
          </AppText>
        ) : null}

        <View style={[styles.ownerRow, { borderTopColor: theme.colors.divider }]}>
          <Avatar
            size={26}
            uri={mediaPublicUrl('avatar', listing.owner?.avatar_path ?? null)}
            name={ownerName}
            recycleKey={listing.owner?.id}
          />
          <View style={styles.flex}>
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              {ownerName}
            </AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {ownerDetail}
            </AppText>
          </View>
          {listing.owner?.is_verified ? (
            <Ionicons name="checkmark-circle" size={14} color={theme.colors.primary} />
          ) : null}
        </View>
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
    borderRadius: 18,
    borderWidth: 1,
  },
  compact: { width: 252 },
  media: {
    height: 152,
    backgroundColor: '#0B1220',
    borderTopLeftRadius: 17,
    borderTopRightRadius: 17,
    overflow: 'hidden',
  },
  mediaCompact: { height: 132 },
  gallery: { flex: 1, flexDirection: 'row', gap: 2 },
  galleryMain: { flex: 2, height: '100%' },
  gallerySide: { flex: 1, gap: 2 },
  gallerySideImage: { flex: 1, width: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: 5 },
  overlayTop: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  kindPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  kindText: { fontWeight: '700' },
  favorite: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  verified: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(6,14,10,0.62)',
  },
  photoCount: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(6,14,10,0.62)',
  },
  body: { padding: 11, gap: 4 },
  title: { minHeight: 40 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 3,
    paddingTop: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
});
