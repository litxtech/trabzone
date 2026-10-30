import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { MapSheet } from '@/features/map/components/MapSheet';
import { useTheme } from '@/theme/ThemeProvider';

import { useImportExternalPlace } from '../hooks/use-explore';
import {
  PLACE_PROVIDER_LABEL,
  usePlaceSearch,
  type PlaceSearchResult,
} from '../hooks/use-place-search';
import type { ExploreSearchItem } from '../types';
import { StorageImage } from './StorageImage';

type RowProps = {
  value: ExploreSearchItem | null;
  onPress: () => void;
  onClear?: () => void;
  /** Reels gibi her zaman koyu yüzeylerde kullanılan varyant. */
  dark?: boolean;
};

/** Gönderi/Reels besteleyicisinde işletme etiketi satırı. */
export function PlaceTagRow({ value, onPress, onClear, dark = false }: RowProps) {
  const { theme } = useTheme();
  const muted = dark ? '#8F9BB6' : theme.colors.textTertiary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `Etiket: ${value.title}` : 'İşletme etiketle'}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: dark ? '#0E1524' : theme.colors.surface,
          borderColor: value
            ? theme.colors.primary
            : dark
              ? 'rgba(255,255,255,0.08)'
              : theme.colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: dark ? 'rgba(96,165,250,0.14)' : theme.colors.primarySoft },
        ]}
      >
        <Ionicons
          name="storefront-outline"
          size={16}
          color={dark ? '#93C5FD' : theme.colors.primaryDeep}
        />
      </View>
      <View style={styles.flex}>
        <AppText
          variant="body"
          color={value ? (dark ? '#FFFFFF' : 'text') : muted}
          numberOfLines={1}
        >
          {value?.title ?? 'İşletme etiketle'}
        </AppText>
        {value ? (
          <AppText variant="caption" color={muted} numberOfLines={1}>
            {[value.category, value.subtitle].filter(Boolean).join(' · ')}
          </AppText>
        ) : (
          <AppText variant="caption" color={muted}>
            İsteğe bağlı — Trabzon’daki bir işletmeyi bağla
          </AppText>
        )}
      </View>
      {value && onClear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Etiketi kaldır"
          hitSlop={8}
          onPress={onClear}
        >
          <Ionicons name="close-circle" size={18} color={muted} />
        </Pressable>
      ) : (
        <Ionicons name="chevron-forward" size={16} color={muted} />
      )}
    </Pressable>
  );
}

type PickerProps = {
  visible: boolean;
  selectedId?: string | null;
  onClose: () => void;
  onSelect: (item: ExploreSearchItem) => void;
  onClear?: () => void;
};

function ProviderTag({ label }: { label: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: theme.colors.surfaceMuted }]}>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

/**
 * Gönderi etiketi için işletme seçici.
 *
 * İki kaynağı birlikte arar:
 *  1. Trabzone'daki yayınlanmış işletme kayıtları (haritadaki işaretçiler),
 *  2. Google / Apple / OpenStreetMap haritalarındaki gerçek işletmeler.
 *
 * Veritabanında olmayan bir işletme seçildiğinde önce kalıcı kayda dönüştürülür
 * (`place_import_external`); böylece etiket, harita işaretçisi ve işletme
 * sayfası aynı kaydı kullanır.
 */
export function PlaceTagPicker({ visible, selectedId, onClose, onSelect, onClear }: PickerProps) {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const debounced = useDebouncedValue(query.trim(), 320);
  const search = usePlaceSearch({ query: debounced, limit: 40 });
  const importPlace = useImportExternalPlace();

  const localRows = search.items.filter((row) => row.origin === 'trabzone');
  const externalRows = search.items.filter((row) => row.origin === 'external');

  const close = () => {
    setQuery('');
    setImportingKey(null);
    setImportError(null);
    onClose();
  };

  const pick = (row: PlaceSearchResult) => {
    if (row.origin === 'trabzone' && row.local) {
      onSelect(row.local);
      close();
      return;
    }
    const suggestion = row.external;
    if (!suggestion || importingKey) {
      return;
    }
    setImportError(null);
    setImportingKey(row.key);
    importPlace.mutate(
      {
        name: suggestion.name,
        lat: suggestion.lat,
        lng: suggestion.lng,
        address: suggestion.address || null,
        phone: suggestion.phone,
        website: suggestion.website,
        provider: suggestion.source,
        externalId: suggestion.externalId ?? null,
        categorySlug: row.categorySlug,
        rating: suggestion.rating,
        ratingCount: suggestion.ratingCount,
      },
      {
        onSuccess: (data) => {
          setImportingKey(null);
          onSelect({
            kind: 'place',
            id: data.place_id,
            title: data.name,
            subtitle: [data.category, data.address].filter(Boolean).join(' · '),
            lat: data.lat,
            lng: data.lng,
            image_path: null,
            rating: suggestion.rating,
            category: data.category ?? row.category,
            verified: false,
            address: data.address,
            phone: suggestion.phone,
          });
          close();
        },
        onError: (error) => {
          setImportingKey(null);
          setImportError(error.message);
        },
      },
    );
  };

  const renderRow = (row: PlaceSearchResult) => {
    const active = row.placeId != null && row.placeId === selectedId;
    const importing = importingKey === row.key;
    return (
      <Pressable
        key={row.key}
        accessibilityRole="button"
        accessibilityState={{ selected: active, busy: importing }}
        disabled={importingKey != null}
        onPress={() => pick(row)}
        style={[
          styles.place,
          {
            borderColor: active ? theme.colors.primary : theme.colors.border,
            backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
          },
        ]}
      >
        {row.imagePath ? (
          <StorageImage
            path={row.imagePath}
            bucket="place-media"
            style={styles.cover}
            fallbackColor={theme.colors.surfaceMuted}
          />
        ) : (
          <View style={[styles.cover, styles.coverFallback, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons
              name={row.origin === 'external' ? 'map-outline' : 'storefront-outline'}
              size={19}
              color={theme.colors.primaryDeep}
            />
          </View>
        )}
        <View style={styles.flex}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {row.title}
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {row.subtitle || row.category || 'Trabzon'}
          </AppText>
          {row.origin === 'external' ? (
            <View style={styles.providerRow}>
              <ProviderTag label={PLACE_PROVIDER_LABEL[row.provider]} />
              {row.rating != null ? (
                <AppText variant="caption" color="warning">
                  ★ {row.rating.toFixed(1)}
                </AppText>
              ) : null}
            </View>
          ) : null}
        </View>
        {importing ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : row.verified ? (
          <Ionicons name="shield-checkmark" size={16} color={theme.colors.success} />
        ) : null}
        {active ? (
          <Ionicons name="checkmark-circle" size={18} color={theme.colors.primaryDeep} />
        ) : null}
      </Pressable>
    );
  };

  return (
    <MapSheet
      visible={visible}
      onClose={close}
      title="İşletme etiketle"
      subtitle="Trabzone’daki ve haritalardaki gerçek işletmeler aranır; etiket gönderiyi işletme sayfasına bağlar."
      maxHeightRatio={0.86}
    >
      <TextField
        autoFocus
        value={query}
        onChangeText={setQuery}
        placeholder="İşletme adı, kategori, mahalle veya ilçe…"
        leftIcon="search"
        autoCapitalize="none"
        returnKeyType="search"
      />

      {selectedId && onClear ? (
        <Button
          label="Etiketi kaldır"
          size="sm"
          variant="ghost"
          onPress={() => {
            onClear();
            close();
          }}
        />
      ) : null}

      {importError ? (
        <View style={[styles.notice, { backgroundColor: theme.colors.dangerSoft }]}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
          <AppText variant="caption" color="danger" style={styles.flex}>
            {importError}
          </AppText>
        </View>
      ) : null}

      {debounced.length < 2 ? (
        <View style={styles.empty}>
          <Ionicons name="storefront-outline" size={26} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" align="center">
            En az 2 karakter yaz. Kategori (kafe, eczane), mahalle (Ortahisar) veya işletme adıyla
            arayabilirsin; haritadaki tüm işletmeler listelenir.
          </AppText>
        </View>
      ) : search.loading ? (
        <AppText variant="caption" color="textTertiary" align="center">
          İşletmeler aranıyor…
        </AppText>
      ) : search.items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={26} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" align="center">
            Eşleşen işletme bulunamadı. Farklı bir ad veya kategori dene; haritadan yeni bir yer
            önerisi de gönderebilirsin.
          </AppText>
        </View>
      ) : (
        <View style={styles.list}>
          {localRows.length > 0 ? (
            <AppText variant="overline" color="textTertiary">
              TRABZONE’DAKİ İŞLETMELER · {localRows.length}
            </AppText>
          ) : null}
          {localRows.map(renderRow)}

          {search.externalLoading ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <AppText variant="caption" color="textTertiary">
                Haritalar taranıyor…
              </AppText>
            </View>
          ) : null}

          {externalRows.length > 0 ? (
            <>
              <AppText variant="overline" color="textTertiary">
                HARİTALARDAKİ İŞLETMELER · {externalRows.length}
              </AppText>
              {externalRows.map(renderRow)}
              <AppText variant="caption" color="textTertiary" align="center" style={styles.attribution}>
                Seçtiğin işletme Trabzone’a eklenir ve haritada işaretçi olarak görünür.
              </AppText>
            </>
          ) : null}
        </View>
      )}
    </MapSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 24, paddingHorizontal: 12 },
  list: { gap: 8, paddingBottom: 12 },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cover: { width: 44, height: 44, borderRadius: 10 },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  inlineLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    padding: 10,
    borderRadius: 12,
  },
  attribution: { paddingTop: 6 },
});
