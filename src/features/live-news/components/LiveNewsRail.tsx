import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from '@/utils/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppImage, AppText, Skeleton } from '@/components/ui';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { publicMediaUrl } from '@/features/media/media-service';
import { TRABZON_BOUNDS } from '@/features/explore/utils/geo';
import { useTheme } from '@/theme/ThemeProvider';
import { supabase } from '@/services/supabase/client';
import { postgresChannel } from '@/services/supabase/realtime';
import { formatRelativeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

import { useLiveNewsList } from '../hooks/use-live-news';
import {
  LIVE_NEWS_DISTRICTS,
  LIVE_NEWS_FILTERS,
  categoryLabel,
} from '../services/live-news-service';
import type { LiveNewsFilter, LiveNewsItem } from '../types';

const MAX_RAIL_ITEMS = 8;

type Coords = { lat: number; lng: number } | null;

/**
 * Ana akışın üstündeki kompakt "Anlık Gelişmeler" girişi.
 *
 * - Yatay kart şeridi akışı ele geçirmez.
 * - Filtreler tek satırda kaydırılır; header'a yeni ikon eklenmez.
 * - "Yakınımda" yalnızca kullanıcı seçtiğinde konum izni ister.
 * - Yeni içerik geldiğinde liste kendiliğinden yer değiştirmez; kullanıcı
 *   "Yeni paylaşımlar" düğmesine bastığında tazelenir.
 */
export function LiveNewsRail() {
  const { theme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<LiveNewsFilter>('all');
  const [district, setDistrict] = useState<string | null>(null);
  const [districtOpen, setDistrictOpen] = useState(false);
  const [coords, setCoords] = useState<Coords>(null);
  const [locating, setLocating] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const filterRef = useRef<LiveNewsFilter>('all');

  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const list = useLiveNewsList({
    filter,
    district: filter === 'districts' ? district : null,
    lat: filter === 'nearby' ? coords?.lat ?? null : null,
    lng: filter === 'nearby' ? coords?.lng ?? null : null,
    limit: MAX_RAIL_ITEMS,
  });

  // Aynı gönderi sayfa sınırında iki kez gelebilir; şerit `item.id` ile
  // anahtarlandığı için tekilleştirilmezse React yinelenen anahtar uyarısı verir.
  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged: LiveNewsItem[] = [];
    for (const page of list.data?.pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push(item);
        if (merged.length >= MAX_RAIL_ITEMS) return merged;
      }
    }
    return merged;
  }, [list.data]);

  // Yeni yayınları yalnızca sayar; listeyi kullanıcının altından kaydırmaz.
  // Gizleme/kaldırma ise tüm yüzeylerden düşmeli: şerit ve akış önbelleği
  // anında tazelenir, kullanıcı yenilemeyi beklemez.
  useEffect(() => {
    const channel = postgresChannel('live-news-rail')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_news' },
        () => {
          if (filterRef.current === 'all') {
            setPendingCount((count) => Math.min(count + 1, 20));
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'live_news' },
        (payload) => {
          const next = payload.new as {
            moderation_status?: string;
            verification_status?: string;
          };
          const visible = next.moderation_status === 'visible';
          // Durum değişikliği anlık listede ve akışta tutarlı görünmeli.
          void queryClient.invalidateQueries({ queryKey: ['live-news'] });
          if (!visible || next.verification_status === 'removed') {
            void queryClient.invalidateQueries({ queryKey: ['feed'] });
          } else if (next.verification_status === 'verified') {
            void queryClient.invalidateQueries({ queryKey: ['feed'] });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'live_news' },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['live-news'] });
          void queryClient.invalidateQueries({ queryKey: ['feed'] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const refresh = useCallback(() => {
    setPendingCount(0);
    haptics.selection();
    void list.refetch();
  }, [list]);

  const locate = useCallback(async (): Promise<Coords> => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Konum izni verilmedi',
          'Yakınındaki gelişmeleri görmek için konum izni gerekir. İlçe filtresini kullanabilirsin.',
        );
        return null;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const lat = current.coords.latitude;
      const lng = current.coords.longitude;
      if (
        lat < TRABZON_BOUNDS.south ||
        lat > TRABZON_BOUNDS.north ||
        lng < TRABZON_BOUNDS.west ||
        lng > TRABZON_BOUNDS.east
      ) {
        Alert.alert(
          'Hizmet bölgesi dışındasın',
          'Şu anda Trabzon sınırları dışındasın. İlçe filtresiyle arama yapabilirsin.',
        );
        return null;
      }
      const next = { lat, lng };
      setCoords(next);
      return next;
    } catch {
      Alert.alert('Konum alınamadı', 'Cihaz konumu okunamadı. İlçe filtresini kullanabilirsin.');
      return null;
    } finally {
      setLocating(false);
    }
  }, []);

  const onSelectFilter = useCallback(
    async (next: LiveNewsFilter) => {
      haptics.selection();
      if (next === 'nearby') {
        if (!coords) {
          const found = await locate();
          if (!found) return;
        }
      }
      if (next === 'districts' && !district) {
        setDistrictOpen(true);
        return;
      }
      setFilter(next);
      setPendingCount(0);
    },
    [coords, district, locate],
  );

  const openItem = useCallback(
    (item: LiveNewsItem) => {
      haptics.tap();
      router.push(`/anlik-haber/${item.id}` as never);
    },
    [router],
  );

  const subtitle =
    filter === 'nearby'
      ? coords
        ? 'Konumuna yakın gelişmeler'
        : 'Konum izni bekleniyor'
      : filter === 'districts'
        ? district ?? 'Tüm ilçeler'
        : 'Trabzon’dan son gelişmeler';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={[styles.liveDot, { backgroundColor: theme.colors.danger }]} />
          <AppText variant="bodyStrong">Anlık Gelişmeler</AppText>
          {pendingCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${pendingCount} yeni anlık gelişme`}
              onPress={refresh}
              style={({ pressed }) => [
                styles.newPill,
                { backgroundColor: theme.colors.primarySoft, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Ionicons name="arrow-up" size={11} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep">
                {pendingCount} yeni
              </AppText>
            </Pressable>
          ) : null}
        </View>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterContent}
      >
        {LIVE_NEWS_FILTERS.map((item) => {
          const active = filter === item.key;
          const label =
            item.key === 'districts' && district ? district : item.label;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: active, busy: locating && item.key === 'nearby' }}
              onPress={() => void onSelectFilter(item.key as LiveNewsFilter)}
              style={({ pressed }) => [
                styles.filter,
                {
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              {locating && item.key === 'nearby' ? (
                <ActivityIndicator size="small" color={theme.colors.primaryDeep} />
              ) : null}
              <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      {list.isLoading ? (
        <View style={styles.rail}>
          {[0, 1].map((key) => (
            <View key={key} style={[styles.card, styles.skeleton, { borderColor: theme.colors.border }]}>
              <Skeleton height={62} width={62} radius={12} />
              <View style={styles.cardText}>
                <Skeleton height={10} width="80%" radius={4} />
                <Skeleton height={10} width="55%" radius={4} />
              </View>
            </View>
          ))}
        </View>
      ) : items.length === 0 ? null : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
        >
          {items.map((item) => (
            <LiveNewsRailCard
              key={item.id}
              item={item}
              onPress={() => openItem(item)}
            />
          ))}
        </ScrollView>
      )}

      <SelectSheet
        visible={districtOpen}
        title="İlçe seç"
        options={LIVE_NEWS_DISTRICTS}
        value={district}
        onClose={() => setDistrictOpen(false)}
        onSelect={(value) => {
          setDistrict(value);
          setDistrictOpen(false);
          setFilter('districts');
          setPendingCount(0);
        }}
      />
    </View>
  );
}

function LiveNewsRailCard({ item, onPress }: { item: LiveNewsItem; onPress: () => void }) {
  const { theme } = useTheme();
  const meta = item.live_news;
  const first = item.media[0];
  const uri = first ? publicMediaUrl('posts', first.thumbnail_path ?? first.storage_path) : null;
  const verified = meta?.verification_status === 'verified';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${meta?.title ?? 'Anlık gelişme'} — ${meta?.district ?? 'Trabzon'}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {uri ? (
        <AppImage source={{ uri }} style={styles.thumb} contentFit="cover" recycleKey={item.id} />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="radio-outline" size={20} color={theme.colors.primaryDeep} />
        </View>
      )}
      <View style={styles.cardText}>
        <View style={styles.cardMeta}>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {meta?.district ?? 'Trabzon'} · {formatRelativeTr(item.created_at)}
          </AppText>
          {verified ? (
            <Ionicons name="checkmark-circle" size={12} color={theme.colors.success} />
          ) : null}
        </View>
        <AppText variant="caption" numberOfLines={2} style={styles.cardTitle}>
          {meta?.title ?? item.body ?? 'Anlık gelişme'}
        </AppText>
        <AppText variant="caption" color="primary" numberOfLines={1}>
          {categoryLabel(meta?.category ?? 'guncel')}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { paddingTop: 10, paddingBottom: 12, gap: 10 },
  header: { paddingHorizontal: 20, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  newPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginLeft: 4,
  },
  filterContent: { paddingHorizontal: 20, gap: 6 },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 30,
  },
  rail: { paddingHorizontal: 20, gap: 8 },
  card: {
    width: 246,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  skeleton: { backgroundColor: 'transparent' },
  thumb: { width: 62, height: 62, borderRadius: 12, overflow: 'hidden' },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 3 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardTitle: { lineHeight: 16 },
});
