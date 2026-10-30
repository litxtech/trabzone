import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ActionSheet, AppText, Button, IconButton, Screen, Skeleton } from '@/components/ui';
import { MarketListingCard } from '@/features/marketplace/components/MarketListingCard';
import {
  useDeleteListingV2,
  useMyListings,
  useSetListingStatusV2,
} from '@/features/marketplace/hooks/use-marketplace-catalog';
import type {
  ListingStatus,
  MarketListing,
  MyListingsScope,
} from '@/features/marketplace/services/marketplace-catalog-service';
import { useTheme } from '@/theme/ThemeProvider';
import { ViewCount } from '@/features/views/components/ViewCount';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

const TABS: { key: MyListingsScope; label: string }[] = [
  { key: 'published', label: 'Yayında' },
  { key: 'pending', label: 'İncelemede' },
  { key: 'draft', label: 'Taslak' },
  { key: 'expired', label: 'Süresi Dolan' },
  { key: 'sold', label: 'Satıldı' },
  { key: 'archived', label: 'Kaldırıldı' },
];

const EMPTY_COPY: Record<MyListingsScope, { title: string; body: string }> = {
  published: {
    title: 'Yayında ilanın yok',
    body: 'İlk ilanını oluştur, Trabzon’daki alıcılara ulaş.',
  },
  pending: {
    title: 'İncelemede ilan yok',
    body: 'Yeni ilanlar anında yayınlanır. Doğrulama bekleyen eski ilanlar burada görünür.',
  },
  draft: { title: 'Taslak yok', body: 'Yarım kalan ilanların otomatik olarak burada saklanır.' },
  expired: {
    title: 'Süresi dolan ilan yok',
    body: 'Süresi biten ilanları buradan yeniden yayınlayabilirsin.',
  },
  sold: {
    title: 'Satıldı ilanı yok',
    body: 'Satıldı olarak işaretlediğin ilanlar burada listelenir.',
  },
  archived: {
    title: 'Kaldırılmış ilan yok',
    body: 'Yayından kaldırdığın ilanları burada bulabilirsin.',
  },
};

export default function MarketMyListingsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [scope, setScope] = useState<MyListingsScope>('published');
  const [menuTarget, setMenuTarget] = useState<MarketListing | null>(null);
  const listings = useMyListings(scope);
  const setStatus = useSetListingStatusV2();
  const remove = useDeleteListingV2();

  const openListing = useCallback(
    (listing: MarketListing) => router.push(`/marketplace/${listing.id}` as never),
    [router],
  );

  const updateStatus = (listing: MarketListing, status: ListingStatus) => {
    setStatus.mutate(
      { id: listing.id, status },
      {
        onSuccess: () => {
          haptics.success();
          void listings.refetch();
        },
        onError: (error) => Alert.alert('Güncellenemedi', error.message || 'Tekrar dene.'),
      },
    );
  };

  const deleteListing = (listing: MarketListing) => {
    Alert.alert('İlanı sil', 'Bu ilan kalıcı olarak silinecek. Emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () =>
          remove.mutate(listing.id, {
            onSuccess: () => {
              haptics.success();
              void listings.refetch();
            },
            onError: (error) => Alert.alert('Silinemedi', error.message || 'Tekrar dene.'),
          }),
      },
    ]);
  };

  const empty = EMPTY_COPY[scope];

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
          <AppText variant="h2">İlanlarım</AppText>
          <AppText variant="caption" color="textTertiary">
            İlanlarını yönet, fiyat ve durum güncelle
          </AppText>
        </View>
        <Button
          label="Yeni"
          size="sm"
          fullWidth={false}
          leftIcon={<Ionicons name="add" size={16} color={theme.colors.onPrimary} />}
          onPress={() => router.push('/marketplace/create' as never)}
        />
      </View>

      <View style={styles.tabsWrap}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {TABS.map((tab) => {
            const active = scope === tab.key;
            const count = listings.counts?.[tab.key] ?? 0;
            return (
              <Pressable
                key={tab.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptics.selection();
                  setScope(tab.key);
                }}
                style={[
                  styles.tab,
                  {
                    backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                    borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                  },
                ]}
              >
                <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                  {tab.label}
                </AppText>
                {count > 0 ? (
                  <View
                    style={[
                      styles.count,
                      {
                        backgroundColor: active
                          ? 'rgba(255,255,255,0.22)'
                          : theme.colors.surfaceMuted,
                      },
                    ]}
                  >
                    <AppText
                      variant="caption"
                      color={active ? 'onPrimary' : 'textTertiary'}
                      style={styles.countText}
                    >
                      {count}
                    </AppText>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {listings.isLoading ? (
        <View style={styles.loading}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} height={124} radius={16} />
          ))}
        </View>
      ) : (
        <FlashList
          keyboardShouldPersistTaps="handled"
          data={listings.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          onEndReached={listings.loadMore}
          onEndReachedThreshold={0.6}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <MarketListingCard
                listing={item}
                layout="row"
                showStatus
                onPress={() => openListing(item)}
              />
              <View style={styles.actionsRow}>
                <View style={styles.stats}>
                  <ViewCount type="marketplace_listing" id={item.id} size={12} />
                  <Ionicons name="heart-outline" size={12} color={theme.colors.textTertiary} />
                  <AppText variant="caption" color="textTertiary">
                    {item.favorite_count}
                  </AppText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="İlan işlemleri"
                  onPress={() => setMenuTarget(item)}
                  style={({ pressed }) => [
                    styles.manageButton,
                    { borderColor: theme.colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Ionicons
                    name="ellipsis-horizontal"
                    size={15}
                    color={theme.colors.textSecondary}
                  />
                  <AppText variant="caption" color="textSecondary">
                    Yönet
                  </AppText>
                </Pressable>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.state}>
              <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="pricetags-outline" size={26} color={theme.colors.primaryDeep} />
              </View>
              <AppText variant="h3" align="center">
                {empty.title}
              </AppText>
              <AppText variant="body" color="textSecondary" align="center">
                {empty.body}
              </AppText>
              {scope === 'published' || scope === 'draft' ? (
                <Button
                  label="İlan oluştur"
                  size="sm"
                  fullWidth={false}
                  style={styles.stateButton}
                  onPress={() => router.push('/marketplace/create' as never)}
                />
              ) : null}
            </View>
          }
          ListFooterComponent={
            listings.isFetchingNextPage ? (
              <ActivityIndicator color={theme.colors.primary} style={styles.footer} />
            ) : (
              <View style={styles.footerSpace} />
            )
          }
          refreshControl={
            <RefreshControl
              refreshing={listings.isRefetching && !listings.isFetchingNextPage}
              onRefresh={() => void listings.refetch()}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
        />
      )}

      <ActionSheet
        visible={Boolean(menuTarget)}
        title={menuTarget?.title}
        items={[
          { key: 'edit', label: 'İlanı düzenle', icon: 'create-outline' },
          ...(menuTarget?.status === 'active'
            ? [
                {
                  key: 'sold',
                  label: 'Satıldı olarak işaretle',
                  icon: 'checkmark-done-outline' as const,
                },
                { key: 'archive', label: 'Yayından kaldır', icon: 'eye-off-outline' as const },
              ]
            : []),
          ...(menuTarget &&
          ['archived', 'expired', 'sold', 'draft', 'pending'].includes(menuTarget.status)
            ? [{ key: 'relist', label: 'Tekrar yayınla', icon: 'refresh-outline' as const }]
            : []),
          { key: 'delete', label: 'İlanı sil', icon: 'trash-outline', destructive: true },
        ]}
        onClose={() => setMenuTarget(null)}
        onSelect={(key) => {
          const selected = menuTarget;
          setMenuTarget(null);
          if (!selected) {
            return;
          }
          if (key === 'edit') {
            router.push({ pathname: '/marketplace/create', params: { id: selected.id } } as never);
          } else if (key === 'sold') {
            updateStatus(selected, 'sold');
          } else if (key === 'archive') {
            updateStatus(selected, 'archived');
          } else if (key === 'relist') {
            updateStatus(selected, 'active');
          } else if (key === 'delete') {
            deleteListing(selected);
          }
        }}
      />
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
  tabsWrap: { paddingBottom: 8 },
  tabs: { gap: 7, paddingHorizontal: 18 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
  },
  count: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontSize: 10, lineHeight: 13 },
  loading: { padding: 18, gap: 9 },
  content: { paddingHorizontal: 18, paddingBottom: 30, gap: 10 },
  cell: { gap: 0 },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingHorizontal: 2,
  },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
  },
  state: { alignItems: 'center', gap: 8, paddingVertical: 52, paddingHorizontal: 28 },
  stateIcon: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateButton: { marginTop: 6 },
  footer: { paddingVertical: 18 },
  footerSpace: { height: 16 },
});
