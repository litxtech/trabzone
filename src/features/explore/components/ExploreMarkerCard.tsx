import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, IconButton } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { PlaceMarker, RealEstateMarker } from '../types';
import { formatDecimal, formatMoney, formatPrice, metersLabel } from '../utils/format';
import { PlaceCoverImage } from './PlaceCoverImage';
import { StorageImage } from './StorageImage';

type Props = {
  marker: PlaceMarker | RealEstateMarker;
  onClose: () => void;
  onOpen: () => void;
  onDirections: () => void;
  onToggleFavorite: () => void;
  favoritePending?: boolean;
  onCall?: (phone: string) => void;
  onReport: () => void;
};

export function ExploreMarkerCard({
  marker,
  onClose,
  onOpen,
  onDirections,
  onToggleFavorite,
  favoritePending,
  onCall,
  onReport,
}: Props) {
  const { theme } = useTheme();
  const isPlace = marker.kind === 'place';
  const favorite = isPlace ? undefined : marker.is_favorite;

  return (
    <View
      style={[
        styles.card,
        theme.shadows.sheet,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.grabberRow}>
        <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
        <IconButton
          name="close"
          accessibilityLabel="Kartı kapat"
          variant="plain"
          size={30}
          onPress={onClose}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${marker.kind === 'place' ? marker.name : marker.title} detayını aç`}
        onPress={onOpen}
        style={styles.body}
      >
        {isPlace ? (
          <PlaceCoverImage
            coverPath={marker.cover_path}
            name={marker.name}
            lat={marker.lat}
            lng={marker.lng}
            size="thumb"
            recycleKey={marker.id}
            style={styles.imageWrap}
            fallback={
              <Ionicons name="storefront-outline" size={26} color={theme.colors.textTertiary} />
            }
          />
        ) : (
          <View style={[styles.imageWrap, { backgroundColor: theme.colors.surfaceMuted }]}>
            <StorageImage
              path={marker.cover_path}
              bucket="real-estate-media"
              style={styles.image}
              recycleKey={marker.id}
            />
            {!marker.cover_path ? (
              <Ionicons
                name="home-outline"
                size={26}
                color={theme.colors.textTertiary}
                style={styles.imageFallback}
              />
            ) : null}
          </View>
        )}

        <View style={styles.info}>
          <View style={styles.titleRow}>
            <AppText variant="bodyStrong" numberOfLines={1} style={styles.title}>
              {isPlace ? marker.name : marker.title}
            </AppText>
            {isPlace && marker.is_verified ? (
              <Ionicons name="shield-checkmark" size={15} color={theme.colors.success} />
            ) : null}
          </View>

          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
            {isPlace
              ? [marker.category_name, marker.district, marker.neighborhood].filter(Boolean).join(' · ')
              : [marker.category_name, marker.district, marker.neighborhood].filter(Boolean).join(' · ')}
          </AppText>

          <View style={styles.metaRow}>
            {isPlace ? (
              <>
                <Badge
                  label={
                    marker.rating != null
                      ? `★ ${formatDecimal(marker.rating, 1)} (${marker.review_count})`
                      : 'Yeni'
                  }
                  tone={marker.rating != null ? 'warning' : 'neutral'}
                />
                {marker.photo_count > 0 ? (
                  <AppText variant="caption" color="textTertiary">
                    {marker.photo_count} fotoğraf
                  </AppText>
                ) : null}
              </>
            ) : (
              <>
                <AppText variant="bodyStrong" color="primaryDeep">
                  {formatPrice(marker.price_cents, marker.currency, marker.price_period)}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {metersLabel(marker.net_m2 ?? marker.gross_m2)}
                  {marker.room_count ? ` · ${marker.room_count} oda` : ''}
                </AppText>
              </>
            )}
          </View>
        </View>
      </Pressable>

      <View style={styles.actions}>
        <Button
          label="Detaylar"
          size="sm"
          onPress={onOpen}
          style={styles.actionButton}
          leftIcon={<Ionicons name="open-outline" size={15} color={theme.colors.onPrimary} />}
        />
        <Button
          label="Yol Tarifi"
          variant="secondary"
          size="sm"
          onPress={onDirections}
          style={styles.actionButton}
          leftIcon={<Ionicons name="navigate-outline" size={15} color={theme.colors.primaryDeep} />}
        />
        <IconButton
          name={favorite ? 'bookmark' : 'bookmark-outline'}
          accessibilityLabel={favorite ? 'Favoriden çıkar' : 'Favoriye ekle'}
          variant="surface"
          size={22}
          disabled={favoritePending}
          onPress={onToggleFavorite}
        />
        {isPlace ? (
          marker.price_level != null ? (
            <Badge label={'₺'.repeat(Math.min(marker.price_level, 4))} tone="neutral" />
          ) : null
        ) : (
          <AppText variant="caption" color="textSecondary">
            {formatMoney(marker.price_cents, marker.currency)}
          </AppText>
        )}
        {isPlace && onCall ? (
          <IconButton
            name="open-outline"
            accessibilityLabel="İşletme detayını aç"
            variant="surface"
            size={22}
            onPress={onOpen}
          />
        ) : null}
        <IconButton
          name="flag-outline"
          accessibilityLabel="Şikâyet et"
          variant="plain"
          size={20}
          onPress={onReport}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: 14,
  },
  grabberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 8,
    paddingTop: 6,
  },
  grabber: { width: 38, height: 4, borderRadius: 2, flex: 1, alignSelf: 'center', marginLeft: 22 },
  body: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 4 },
  imageWrap: {
    width: 92,
    height: 92,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  imageFallback: { position: 'absolute' },
  info: { flex: 1, gap: 4, justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  actionButton: { flexGrow: 1, flexBasis: 0, minWidth: 96 },
});
