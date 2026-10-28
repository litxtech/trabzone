import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { MapSheet } from '@/features/map/components/MapSheet';
import { useTheme } from '@/theme/ThemeProvider';

import { useExploreSearch } from '../hooks/use-explore';
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

/** Yalnızca yayınlanmış işletme kayıtlarını arar; emlak/ilçe sonuçlarını göstermez. */
export function PlaceTagPicker({ visible, selectedId, onClose, onSelect, onClear }: PickerProps) {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), 320);
  const search = useExploreSearch(debounced);
  const result = search.data as { items: ExploreSearchItem[] } | undefined;
  const places = (result?.items ?? []).filter((item) => item.kind === 'place');

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <MapSheet
      visible={visible}
      onClose={close}
      title="İşletme etiketle"
      subtitle="Etiket, içeriği işletme sayfasındaki video/gönderi bölümüne bağlar."
      maxHeightRatio={0.86}
    >
      <TextField
        autoFocus
        value={query}
        onChangeText={setQuery}
        placeholder="İşletme adı, kategori veya mahalle…"
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

      {debounced.length < 2 ? (
        <View style={styles.empty}>
          <Ionicons name="storefront-outline" size={26} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" align="center">
            En az 2 karakter yazarak Trabzon’daki işletmelerde ara. Sonuçlar yalnızca yayınlanmış
            gerçek kayıtlardan gelir.
          </AppText>
        </View>
      ) : search.isLoading ? (
        <AppText variant="caption" color="textTertiary" align="center">
          İşletmeler aranıyor…
        </AppText>
      ) : places.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={26} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" align="center">
            Eşleşen işletme bulunamadı. Haritadan yeni bir yer önerisi gönderebilirsin.
          </AppText>
        </View>
      ) : (
        <View style={styles.list}>
          {places.map((item) => {
            const active = String(item.id) === selectedId;
            return (
              <Pressable
                key={`place:${item.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onSelect(item);
                  close();
                }}
                style={[
                  styles.place,
                  {
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                  },
                ]}
              >
                <StorageImage
                  path={item.image_path}
                  bucket="place-media"
                  style={styles.cover}
                  fallbackColor={theme.colors.surfaceMuted}
                />
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {item.title}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {[item.category, item.subtitle].filter(Boolean).join(' · ') || 'Trabzon'}
                  </AppText>
                </View>
                {item.verified ? (
                  <Ionicons name="shield-checkmark" size={16} color={theme.colors.success} />
                ) : null}
                {active ? (
                  <Ionicons name="checkmark-circle" size={18} color={theme.colors.primaryDeep} />
                ) : null}
              </Pressable>
            );
          })}
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
  list: { gap: 8 },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cover: { width: 44, height: 44, borderRadius: 10 },
});
