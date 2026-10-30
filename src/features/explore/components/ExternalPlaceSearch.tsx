import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { AppText, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { useExternalPlaceSearch } from '../hooks/use-external-place-search';
import { externalPlaceSearchMessage } from '../services/place-search-service';
import type { ExternalPlaceSuggestion, LatLng } from '../types';

const SOURCE_LABEL: Record<ExternalPlaceSuggestion['source'], string> = {
  google: 'Google',
  apple: 'Apple',
  osm: 'OpenStreetMap',
};

type Props = {
  /** Aramayı işletmenin bulunduğu bölgeye yakınlaştırır. */
  around: LatLng | null;
  onPick: (item: ExternalPlaceSuggestion) => void;
  disabled?: boolean;
};

/**
 * "Haritaya yer ekle" formunun üstündeki harici arama.
 *
 * Google ve Apple haritalarındaki işletmeleri arar; seçilen kayıt formun
 * ad, adres, konum ve telefon alanlarını doldurur. Trabzone'da kaydı
 * olmayan işletmelerin elle yazılmak zorunda kalmasını engeller.
 */
export function ExternalPlaceSearch({ around, onPick, disabled = false }: Props) {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ExternalPlaceSuggestion | null>(null);
  const search = useExternalPlaceSearch({ query, around, enabled: !disabled && !picked });

  const handlePick = (item: ExternalPlaceSuggestion) => {
    haptics.selection();
    Keyboard.dismiss();
    onPick(item);
    setPicked(item);
    setQuery('');
  };

  const reset = () => {
    setPicked(null);
    setQuery('');
  };

  const errorText = search.error ? externalPlaceSearchMessage(search.error) : null;

  return (
    <View style={styles.group}>
      <View style={styles.head}>
        <View style={[styles.headIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="map-outline" size={17} color={theme.colors.primaryDeep} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">İşletmeyi haritada bul</AppText>
          <AppText variant="caption" color="textTertiary">
            Google, Apple ve OpenStreetMap haritalarındaki işletmeleri ara, formu otomatik doldur
          </AppText>
        </View>
      </View>

      {picked ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Seçili işletme ${picked.name}. Değiştirmek için dokun.`}
          onPress={reset}
          style={({ pressed }) => [
            styles.picked,
            {
              backgroundColor: theme.colors.primarySoft,
              borderColor: theme.colors.primary,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Ionicons name="checkmark-circle" size={18} color={theme.colors.primaryDeep} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong" color="primaryDeep" numberOfLines={1}>
              {picked.name}
            </AppText>
            <AppText variant="caption" color="primaryDeep" numberOfLines={1}>
              {[SOURCE_LABEL[picked.source], picked.address].filter(Boolean).join(' · ')}
            </AppText>
          </View>
          <AppText variant="caption" color="primaryDeep">
            Değiştir
          </AppText>
        </Pressable>
      ) : (
        <TextField
          label="Haritalarda ara"
          value={query}
          onChangeText={(value) => {
            setQuery(value);
          }}
          placeholder="Örn. Uzungöl Kahvaltı Evi"
          leftIcon="search-outline"
          autoCorrect={false}
          returnKeyType="search"
          editable={!disabled}
          rightSlot={
            search.loading ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : query.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Aramayı temizle"
                hitSlop={8}
                onPress={() => setQuery('')}
              >
                <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
              </Pressable>
            ) : null
          }
        />
      )}

      {!picked && query.trim().length >= 2 ? (
        errorText ? (
          <View style={[styles.state, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons name="cloud-offline-outline" size={15} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              {errorText}
            </AppText>
          </View>
        ) : !search.loading && search.searched && search.items.length === 0 ? (
          <View style={[styles.state, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons name="search-outline" size={15} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              Bu adla işletme bulunamadı. Bilgileri elle girebilir veya farklı bir ad
              deneyebilirsin.
            </AppText>
          </View>
        ) : search.items.length > 0 ? (
          <View style={[styles.list, { borderColor: theme.colors.border }]}>
            {search.items.map((item, index) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`İşletme önerisi: ${item.name}`}
                onPress={() => handlePick(item)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
                    borderTopColor: theme.colors.divider,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTitle}>
                    <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                      {item.name}
                    </AppText>
                    {item.closed ? (
                      <View style={[styles.tag, { backgroundColor: theme.colors.dangerSoft }]}>
                        <AppText variant="caption" color="danger">
                          Geçici kapalı
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                    {[item.category, item.address].filter(Boolean).join(' · ')}
                  </AppText>
                  <View style={styles.metaRow}>
                    {item.sources.map((source) => (
                      <View
                        key={source}
                        style={[styles.tag, { backgroundColor: theme.colors.surfaceMuted }]}
                      >
                        <AppText variant="caption" color="textSecondary">
                          {SOURCE_LABEL[source]}
                        </AppText>
                      </View>
                    ))}
                    {item.rating != null ? (
                      <View style={styles.rating}>
                        <Ionicons name="star" size={11} color={theme.colors.warning} />
                        <AppText variant="caption" color="textSecondary">
                          {item.rating.toFixed(1)}
                          {item.ratingCount ? ` (${item.ratingCount})` : ''}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Ionicons name="add-circle" size={22} color={theme.colors.primary} />
              </Pressable>
            ))}
            <AppText
              variant="caption"
              color="textTertiary"
              style={[styles.attribution, { borderTopColor: theme.colors.divider }]}
            >
              Sonuçlar Google, Apple ve OpenStreetMap haritalarından gelir; bilgileri göndermeden
              önce doğrulaman önerilir.
            </AppText>
          </View>
        ) : null
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  state: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    padding: 10,
    borderRadius: 12,
  },
  list: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  attribution: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
