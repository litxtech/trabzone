import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { searchPlaces } from '../services/map-service';
import type { LatLng, MapSavedPlace, MapSearchResult } from '../types';
import { MapSheet } from './MapSheet';

const KIND_LABEL: Record<MapSearchResult['kind'], string> = {
  city: 'Şehir',
  district: 'İlçe',
  neighborhood: 'Mahalle',
  place: 'Mekân',
  address: 'Adres',
};

/**
 * Merkezi harita araması. Sonuç seçildiği anda panel kapanır ve harita ilgili
 * bölgeye akıcı şekilde odaklanır. Kayıtlı yerler boş sorguda hızlı erişim
 * olarak listelenir.
 */
export function MapSearchSheet({
  visible,
  onClose,
  onPick,
  onPickSaved,
  onSaveResult,
  proximity,
  saved,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (result: MapSearchResult) => void;
  onPickSaved: (place: MapSavedPlace) => void;
  onSaveResult?: (result: MapSearchResult) => void;
  proximity?: LatLng | null;
  saved: MapSavedPlace[];
}) {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MapSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const id = ++requestId.current;
    if (trimmed.length < 2) {
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      setMessage(null);
      const response = await searchPlaces(trimmed, { proximity, limit: 10 });
      if (id !== requestId.current) {
        return;
      }
      setLoading(false);
      if (response.ok) {
        setResults(response.data);
        setMessage(response.data.length === 0 ? 'Bu arama için sonuç bulunamadı.' : null);
      } else {
        setResults([]);
        setMessage(
          response.reason === 'no_token'
            ? 'Harita araması için Mapbox anahtarı tanımlanmalı.'
            : response.reason === 'network'
              ? 'Bağlantı kurulamadı. İnternetini kontrol et.'
              : 'Arama şu anda yanıt vermiyor.',
        );
      }
    }, 350);

    return () => {
      clearTimeout(timer);
    };
  }, [proximity, query]);

  const searching = query.trim().length >= 2;

  return (
    <MapSheet visible={visible} onClose={onClose} title="Haritada ara" subtitle="Şehir, mekân, adres veya mahalle">
      <TextField
        placeholder="Örn. Uzungöl, Trabzon, Atatürk Alanı"
        value={query}
        onChangeText={setQuery}
        leftIcon="search-outline"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        autoFocus
        rightSlot={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sesli arama"
            hitSlop={8}
            onPress={() => {
              haptics.tap();
              setVoiceNote((value) => !value);
            }}
          >
            <Ionicons name="mic-outline" size={20} color={theme.colors.textTertiary} />
          </Pressable>
        }
      />

      {voiceNote ? (
        <View style={[styles.notice, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
          <Ionicons name="information-circle-outline" size={16} color={theme.colors.warning} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Sesli arama bu derlemede yapılandırılmadı. Metinle arayabilirsin; mikrofon izni istenmez.
          </AppText>
        </View>
      ) : null}

      {loading && searching ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : null}

      {searching && message ? (
        <AppText variant="caption" color="textTertiary" align="center">
          {message}
        </AppText>
      ) : null}

      {searching && results.length > 0
        ? results.map((result) => (
            <Pressable
              key={result.id}
              accessibilityRole="button"
              accessibilityLabel={result.label}
              onPress={() => {
                haptics.tap();
                onPick(result);
              }}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                  borderColor: theme.colors.divider,
                },
              ]}
            >
              <View style={[styles.icon, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Ionicons name="location-outline" size={17} color={theme.colors.primaryDeep} />
              </View>
              <View style={styles.flex}>
                <AppText variant="body" numberOfLines={1}>
                  {result.shortLabel}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                  {result.label}
                </AppText>
              </View>
              <AppText variant="caption" color="textTertiary">
                {KIND_LABEL[result.kind]}
              </AppText>
              {onSaveResult ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${result.shortLabel} yerini kaydet`}
                  hitSlop={8}
                  onPress={() => {
                    haptics.tap();
                    onSaveResult(result);
                  }}
                >
                  <Ionicons name="bookmark-outline" size={18} color={theme.colors.primaryDeep} />
                </Pressable>
              ) : null}
            </Pressable>
          ))
        : null}

      {!searching && saved.length > 0 ? (
        <View style={styles.block}>
          <AppText variant="label" color="textSecondary">
            Kaydedilen yerlerin
          </AppText>
          {saved.slice(0, 6).map((place) => (
            <Pressable
              key={place.id}
              accessibilityRole="button"
              accessibilityLabel={place.title}
              onPress={() => {
                haptics.tap();
                onPickSaved(place);
              }}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                  borderColor: theme.colors.divider,
                },
              ]}
            >
              <View style={[styles.icon, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Ionicons name="bookmark-outline" size={17} color={theme.colors.primaryDeep} />
              </View>
              <View style={styles.flex}>
                <AppText variant="body" numberOfLines={1}>
                  {place.title}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  {place.address ?? 'Kaydedilen yer'}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {!searching && saved.length === 0 ? (
        <AppText variant="caption" color="textTertiary" align="center">
          En az 2 karakter yazarak aramaya başla. Arama sonuçları haritada odaklanır.
        </AppText>
      ) : null}
    </MapSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  icon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  center: { paddingVertical: 12, alignItems: 'center' },
  notice: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  block: { gap: 2 },
});
