import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import type { MapPreferences, MapRegion, MapSavedPlace } from '../types';
import { formatMinutesLeft } from '../utils/map-theme';
import { MapSheet } from './MapSheet';

const COLLECTION_LABEL: Record<MapSavedPlace['collection'], string> = {
  favorites: 'Favoriler',
  wishlist: 'Gitmek istediklerim',
  trips: 'Gezilerim',
  custom: 'Özel koleksiyon',
};

/**
 * "Benim Haritam" — kullanıcının harita merkezi. Yalnızca gerçekten var olan
 * veriler gösterilir; bağlı olmayan bölümler için sahte içerik üretilmez.
 */
export function MapMyMapSheet({
  visible,
  onClose,
  prefs,
  savedPlaces,
  regions,
  onDeletePlace,
  onUnfollowRegion,
  onStopShare,
  onOpenSearch,
  onOpenSafety,
}: {
  visible: boolean;
  onClose: () => void;
  prefs: MapPreferences;
  savedPlaces: MapSavedPlace[];
  regions: MapRegion[];
  onDeletePlace: (id: string) => void;
  onUnfollowRegion: (id: string) => void;
  onStopShare: () => void;
  onOpenSearch: () => void;
  onOpenSafety: () => void;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const activeShare = prefs.activeShare;

  const grouped = savedPlaces.reduce<Record<MapSavedPlace['collection'], MapSavedPlace[]>>(
    (accumulator, place) => {
      accumulator[place.collection] = [...(accumulator[place.collection] ?? []), place];
      return accumulator;
    },
    { favorites: [], wishlist: [], trips: [], custom: [] },
  );

  return (
    <MapSheet visible={visible} onClose={onClose} title="Benim haritam" subtitle="Kaydettiklerin, paylaşımların ve tercihlerin">
      <View style={[styles.summary, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
        <SummaryCell label="Kayıtlı yer" value={String(savedPlaces.length)} />
        <SummaryCell label="Bölge" value={String(regions.length)} />
        <SummaryCell label="Görünürlük" value={prefs.ghostMode ? 'Hayalet' : prefs.visibility === 'selected' ? 'Seçili' : 'Arkadaşlar'} />
      </View>

      {activeShare ? (
        <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
          <View style={styles.rowHead}>
            <Ionicons name="radio-outline" size={16} color={theme.colors.success} />
            <AppText variant="bodyStrong" style={styles.flex}>
              Konum paylaşımı açık
            </AppText>
            <AppText variant="caption" color="textSecondary">
              {formatMinutesLeft(activeShare.expires_at) ?? '—'} kaldı
            </AppText>
          </View>
          <Button label="Paylaşımı durdur" variant="outline" size="sm" onPress={onStopShare} />
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.rowHead}>
          <AppText variant="label" color="textSecondary" style={styles.flex}>
            Kaydedilen yerler
          </AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Yer ara ve kaydet" onPress={onOpenSearch}>
            <Ionicons name="add" size={18} color={theme.colors.primaryDeep} />
          </Pressable>
        </View>

        {savedPlaces.length === 0 ? (
          <AppText variant="caption" color="textTertiary">
            Henüz kaydedilen yer yok. Arama sonucundan yer kaydedebilirsin.
          </AppText>
        ) : (
          (Object.keys(grouped) as MapSavedPlace['collection'][]).map((collection) =>
            grouped[collection].length === 0 ? null : (
              <View key={collection} style={styles.group}>
                <AppText variant="caption" color="textTertiary">
                  {COLLECTION_LABEL[collection]}
                </AppText>
                {grouped[collection].map((place) => (
                  <View key={place.id} style={[styles.itemRow, { borderColor: theme.colors.divider }]}>
                    <Ionicons name="bookmark-outline" size={15} color={theme.colors.primaryDeep} />
                    <View style={styles.flex}>
                      <AppText variant="caption" numberOfLines={1}>
                        {place.title}
                      </AppText>
                      {place.address ? (
                        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                          {place.address}
                        </AppText>
                      ) : null}
                    </View>
                    <AppText variant="caption" color="textTertiary">
                      {place.visibility === 'public' ? 'Herkese açık' : place.visibility === 'link' ? 'Bağlantıyla' : 'Özel'}
                    </AppText>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${place.title} kaydını sil`}
                      hitSlop={8}
                      onPress={() => onDeletePlace(place.id)}
                    >
                      <Ionicons name="trash-outline" size={16} color={theme.colors.danger} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ),
          )
        )}
      </View>

      <View style={styles.section}>
        <AppText variant="label" color="textSecondary">
          Takip edilen bölgeler
        </AppText>
        {regions.length === 0 ? (
          <AppText variant="caption" color="textTertiary">
            Takip edilen bölge yok. Bölge bildirimleri bildirim tercihlerinden yönetilecek.
          </AppText>
        ) : (
          regions.map((region) => (
            <View key={region.id} style={[styles.itemRow, { borderColor: theme.colors.divider }]}>
              <Ionicons name="notifications-outline" size={15} color={theme.colors.primaryDeep} />
              <View style={styles.flex}>
                <AppText variant="caption">{region.label}</AppText>
                <AppText variant="caption" color="textTertiary">
                  {region.radius_km} km · {region.notify_mode === 'off' ? 'kapalı' : region.notify_mode === 'instant' ? 'anında' : region.notify_mode === 'important' ? 'önemli gelişmeler' : 'günlük özet'}
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${region.label} takibini bırak`}
                hitSlop={8}
                onPress={() => onUnfollowRegion(region.id)}
              >
                <Ionicons name="close" size={16} color={theme.colors.textTertiary} />
              </Pressable>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <AppText variant="label" color="textSecondary">
          Yaklaşan yolculuklar ve grup buluşmaları
        </AppText>
        <AppText variant="caption" color="textTertiary">
          Yolculuk modülündeki aktif rezervasyonlar Yolculuk sekmesinde yönetilir. Grup buluşmaları ve gezi planları modülü
          bağlandığında burada listelenecek.
        </AppText>
        <Button label="Yolculuklarım" variant="outline" size="sm" onPress={() => router.push('/ride/trips' as never)} />
      </View>

      <View style={styles.section}>
        <Button label="Güvenlik merkezi" variant="secondary" size="sm" onPress={onOpenSafety} />
        <Button
          label="Harita tercihleri"
          variant="outline"
          size="sm"
          onPress={() => {
            onClose();
            router.push('/settings/privacy');
          }}
        />
      </View>
    </MapSheet>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryCell}>
      <AppText variant="bodyStrong" color="primaryDeep">
        {value}
      </AppText>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  summaryCell: { flex: 1, alignItems: 'center', gap: 2 },
  card: { gap: 9, padding: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  section: { gap: 7 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1, gap: 1 },
  group: { gap: 3 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
