import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { MapSheet } from '@/features/map/components/MapSheet';
import { useTheme } from '@/theme/ThemeProvider';

import type { AreaSearchResult, PlaceMarker, RealEstateMarker } from '../types';
import { formatPrice } from '../utils/format';
import { StorageImage } from './StorageImage';

type Props = {
  visible: boolean;
  result: AreaSearchResult | null;
  onClose: () => void;
  onSelectPlace: (place: PlaceMarker) => void;
  onSelectListing: (listing: RealEstateMarker) => void;
  onSave: () => void;
  onEdit: () => void;
};

export function AreaResultSheet({
  visible,
  result,
  onClose,
  onSelectPlace,
  onSelectListing,
  onSave,
  onEdit,
}: Props) {
  const { theme } = useTheme();
  const places = result?.places ?? [];
  const listings = result?.listings ?? [];
  const empty = places.length === 0 && listings.length === 0;

  return (
    <MapSheet
      visible={visible}
      onClose={onClose}
      title="Çizilen alandaki sonuçlar"
      subtitle={
        result
          ? `${result.area_m2.toLocaleString('tr-TR')} m² alan · ${places.length} işletme · ${listings.length} emlak`
          : undefined
      }
      maxHeightRatio={0.9}
      footer={
        <View style={styles.footer}>
          <Button label="Yeniden çiz" variant="outline" onPress={onEdit} style={styles.flex} />
          <Button label="Aramayı kaydet" onPress={onSave} style={styles.flex} disabled={empty} />
        </View>
      }
    >
      {empty ? (
        <View style={styles.empty}>
          <Ionicons name="map-outline" size={30} color={theme.colors.textTertiary} />
          <AppText variant="bodyStrong" align="center">
            Bu alanda eşleşen kayıt yok
          </AppText>
          <AppText variant="caption" color="textTertiary" align="center">
            Alanı genişletmeyi veya filtreleri azaltmayı dene. Yalnızca yayınlanmış işletmeler ve
            doğrulanmış emlak ilanları listelenir.
          </AppText>
        </View>
      ) : (
        <>
          {listings.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <AppText variant="label" color="textSecondary">
                  EMLAK İLANLARI
                </AppText>
                <Badge label={String(listings.length)} tone="primary" />
              </View>
              {listings.map((listing) => (
                <Pressable
                  key={listing.id}
                  accessibilityRole="button"
                  onPress={() => onSelectListing(listing)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      borderColor: theme.colors.border,
                      backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
                    },
                  ]}
                >
                  <StorageImage
                    path={listing.cover_path}
                    bucket="real-estate-media"
                    style={styles.thumb}
                  />
                  <View style={styles.rowText}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {listing.title}
                    </AppText>
                    <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                      {[listing.district, listing.neighborhood].filter(Boolean).join(' · ')}
                    </AppText>
                    <AppText variant="caption" color="primaryDeep">
                      {formatPrice(listing.price_cents, listing.currency, listing.price_period)}
                    </AppText>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          ) : null}

          {places.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <AppText variant="label" color="textSecondary">
                  İŞLETMELER
                </AppText>
                <Badge label={String(places.length)} tone="accent" />
              </View>
              {places.map((place) => (
                <Pressable
                  key={place.id}
                  accessibilityRole="button"
                  onPress={() => onSelectPlace(place)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      borderColor: theme.colors.border,
                      backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
                    },
                  ]}
                >
                  <StorageImage path={place.cover_path} bucket="place-media" style={styles.thumb} />
                  <View style={styles.rowText}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {place.name}
                    </AppText>
                    <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                      {[place.category_name, place.district].filter(Boolean).join(' · ')}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {place.rating != null ? `★ ${place.rating.toFixed(1)} · ${place.review_count} yorum` : 'Yeni işletme'}
                    </AppText>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
    </MapSheet>
  );
}

const styles = StyleSheet.create({
  empty: { paddingVertical: 30, gap: 8, alignItems: 'center' },
  section: { gap: 8, paddingBottom: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
  },
  thumb: { width: 54, height: 54, borderRadius: 10 },
  rowText: { flex: 1, gap: 2 },
  footer: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
