import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, IconButton, Screen, Skeleton } from '@/components/ui';
import {
  useDeleteSavedSearch,
  useSaveSearch,
  useSavedSearches,
} from '@/features/marketplace/hooks/use-marketplace-catalog';
import type { SavedSearch } from '@/features/marketplace/services/marketplace-catalog-service';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

export default function MarketSavedSearchesScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const searches = useSavedSearches();
  const remove = useDeleteSavedSearch();
  const save = useSaveSearch();

  const items = useMemo(() => searches.data ?? [], [searches.data]);

  const openSearch = (search: SavedSearch) => {
    const filters = search.filters;
    const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
    const num = (value: unknown) => (value == null || value === '' ? undefined : String(value));
    router.push({
      pathname: '/marketplace/catalog',
      params: {
        title: search.label,
        query: str(filters.query),
        kind: str(filters.kind),
        category: str(filters.category),
        subcategory: str(filters.subcategory),
        districtId: num(filters.district_id),
        minPrice: num(filters.min_price),
        maxPrice: num(filters.max_price),
        condition: str(filters.condition),
        sort: str(filters.sort),
        favorites: filters.favorites ? '1' : undefined,
      },
    } as never);
  };

  const toggleNotify = (search: SavedSearch) => {
    save.mutate(
      {
        id: search.id,
        label: search.label,
        filters: search.filters,
        notifyEnabled: !search.notify_enabled,
      },
      {
        onError: (error) => Alert.alert('Güncellenemedi', error.message || 'Tekrar dene.'),
      },
    );
  };

  const confirmDelete = (search: SavedSearch) => {
    Alert.alert('Aramayı sil', `“${search.label}” araması silinecek.`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () =>
          remove.mutate(search.id, {
            onError: (error) => Alert.alert('Silinemedi', error.message || 'Tekrar dene.'),
          }),
      },
    ]);
  };

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Geri"
          variant="surface"
          size={20}
          onPress={() => router.back()}
        />
        <View style={styles.flex}>
          <AppText variant="h2">Kaydedilmiş aramalar</AppText>
          <AppText variant="caption" color="textTertiary">
            Yeni ilanlar için alarmlarını yönet
          </AppText>
        </View>
        <IconButton
          name="add"
          accessibilityLabel="Yeni arama"
          variant="surface"
          size={20}
          onPress={() => router.push('/marketplace/search' as never)}
        />
      </View>

      {searches.isLoading ? (
        <View style={styles.loading}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} height={84} radius={16} />
          ))}
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          {items.length ? (
            items.map((search) => (
              <Pressable
                key={search.id}
                accessibilityRole="button"
                accessibilityLabel={`${search.label} aramasını aç`}
                onPress={() => {
                  haptics.tap();
                  openSearch(search);
                }}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name="bookmark" size={17} color={theme.colors.primaryDeep} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {search.label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {formatDateTr(search.created_at)} ·{' '}
                    {search.notify_enabled ? 'Bildirim açık' : 'Bildirim kapalı'}
                  </AppText>
                </View>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel={search.notify_enabled ? 'Bildirimi kapat' : 'Bildirimi aç'}
                  accessibilityState={{ checked: search.notify_enabled }}
                  hitSlop={6}
                  onPress={() => {
                    haptics.selection();
                    toggleNotify(search);
                  }}
                  style={[
                    styles.switch,
                    {
                      backgroundColor: search.notify_enabled
                        ? theme.colors.primary
                        : theme.colors.borderStrong,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.knob,
                      { alignSelf: search.notify_enabled ? 'flex-end' : 'flex-start' },
                    ]}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Aramayı sil"
                  hitSlop={8}
                  onPress={() => confirmDelete(search)}
                >
                  <Ionicons name="trash-outline" size={17} color={theme.colors.textTertiary} />
                </Pressable>
              </Pressable>
            ))
          ) : (
            <View style={styles.state}>
              <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="bookmark-outline" size={26} color={theme.colors.primaryDeep} />
              </View>
              <AppText variant="h3" align="center">
                Kaydedilmiş arama yok
              </AppText>
              <AppText variant="body" color="textSecondary" align="center">
                Filtreleri ayarlayıp “Aramayı kaydet” ile yeni ilan alarmı oluştur.
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Arama yap"
                onPress={() => router.push('/marketplace/search' as never)}
                style={[styles.stateButton, { backgroundColor: theme.colors.primaryDeep }]}
              >
                <AppText variant="label" color="onPrimary">
                  Arama yap
                </AppText>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 8,
  },
  flex: { flex: 1, gap: 1 },
  loading: { padding: 18, gap: 9 },
  content: { paddingHorizontal: 18, paddingBottom: 34, gap: 9 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  switch: { width: 42, height: 25, borderRadius: 13, padding: 3, justifyContent: 'center' },
  knob: { width: 19, height: 19, borderRadius: 10, backgroundColor: '#FFFFFF' },
  state: { alignItems: 'center', gap: 8, paddingVertical: 50, paddingHorizontal: 28 },
  stateIcon: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateButton: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999, marginTop: 6 },
});
