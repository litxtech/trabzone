import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Avatar } from '@/components/ui';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { MAP_KIND_ICON, MAP_KIND_LABEL } from '../constants';
import type { MapMode, MapPoint } from '../types';
import { formatRelativeTime, markerTone, toneColor } from '../utils/map-theme';
import { MapPointCard } from './MapPointCard';

export type PanelState = 'compact' | 'half' | 'expanded';

const MODE_EMPTY: Record<MapMode, string> = {
  social: 'Yakınlarda konum paylaşan arkadaş yok. Hayalet modundaki arkadaşlar haritada görünmez.',
  ride: 'Bu bölgede açık yolculuk ilanı veya yolcu talebi yok.',
  explore: 'Bu bölgede keşfedilecek işaret yok. Başka bir bölgeye kaydırarak dene.',
  support: 'Yakınlarda yardım talebi bulunmuyor.',
};

/**
 * Haritanın altındaki ortak keşif paneli.
 *
 * Panel yüksekliği gesture ile ayarlanır, snap noktaları kompakt/yarım/geniş.
 * İçerik seçili işarete göre değişir; panel açılıp kapanırken harita yeniden
 * oluşturulmaz (panel haritanın kardeşi, üstünde ayrı bir katman).
 */
export function MapDiscoveryPanel({
  state,
  onChangeState,
  points,
  counts,
  selected,
  loading,
  error,
  onRetry,
  onSelectPoint,
  onClearSelection,
  onZoomIn,
  onDirections,
  mode,
  radiusKm,
  updatedAt,
}: {
  state: PanelState;
  onChangeState: (state: PanelState) => void;
  points: MapPoint[];
  counts: { friends: number; rides: number };
  selected: MapPoint | null;
  loading: boolean;
  error?: string | null;
  onRetry: () => void;
  onSelectPoint: (point: MapPoint) => void;
  onClearSelection: () => void;
  onZoomIn: () => void;
  onDirections: (target: { lat: number; lng: number }) => void;
  mode: MapMode;
  radiusKm: number;
  updatedAt?: string | null;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const heights = useMemo(() => {
    const compact = 118 + Math.max(insets.bottom, 8);
    const half = Math.min(windowHeight * 0.47, 420);
    const expanded = Math.min(windowHeight * 0.78, 680);
    return {
      compact,
      half: Math.max(half, compact + 80),
      expanded: Math.max(expanded, compact + 160),
    };
  }, [insets.bottom, windowHeight]);

  const target = heights[state];
  const animatedHeight = useSharedValue(target);
  const dragStart = useSharedValue(target);

  useEffect(() => {
    animatedHeight.set(
      withTiming(target, {
        duration: 240,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [animatedHeight, target]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Kucuk bir esik: dokunuslar (basligi ac/kapat) jesti tetiklemez,
        // yalnizca gercek dikey surukleme paneli boyutlandirir.
        .activeOffsetY([-8, 8])
        .onBegin(() => {
          dragStart.set(animatedHeight.get());
        })
        .onUpdate((event) => {
          const next = dragStart.get() - event.translationY;
          animatedHeight.set(Math.min(Math.max(next, heights.compact - 16), heights.expanded + 16));
        })
        .onEnd((event) => {
          const current = animatedHeight.get();
          const midpointHalf = (heights.compact + heights.half) / 2;
          const midpointExpanded = (heights.half + heights.expanded) / 2;
          let next: PanelState;
          if (event.velocityY < -420 || current > midpointExpanded) {
            next = 'expanded';
          } else if (event.velocityY > 420 || current < midpointHalf) {
            next = 'compact';
          } else {
            next = 'half';
          }
          if (next === 'compact' && current > heights.half) {
            next = 'half';
          }
          runOnJS(haptics.tap)();
          runOnJS(onChangeState)(next);
        }),
    [animatedHeight, dragStart, heights, onChangeState],
  );

  const animatedStyle = useAnimatedStyle(() => ({ height: animatedHeight.get() }));

  const summary = `${counts.friends} arkadaş · ${counts.rides} yolculuk`;
  const nearby = points.filter((point) => point.kind !== 'cluster');

  return (
    <Animated.View
      style={[
        styles.panel,
        theme.shadows.card,
        animatedStyle,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      <GestureDetector gesture={pan}>
        <View style={styles.grabArea}>
          <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              state === 'expanded'
                ? 'Paneli küçült'
                : state === 'compact'
                  ? 'Paneli aç'
                  : 'Paneli genişlet'
            }
            onPress={() => {
              haptics.tap();
              onChangeState(
                state === 'expanded' ? 'compact' : state === 'compact' ? 'half' : 'expanded',
              );
            }}
            style={styles.headerRow}
          >
            <View style={styles.flex}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {selected ? (MAP_KIND_LABEL[selected.kind] ?? 'Seçili işaret') : 'Yakınındakiler'}
              </AppText>
              <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                {selected
                  ? selected.title
                  : loading
                    ? 'Bölge taranıyor…'
                    : `${summary} · ${Math.round(radiusKm)} km`}
              </AppText>
            </View>

            {updatedAt && !selected ? (
              <AppText variant="caption" color="textTertiary">
                {formatRelativeTime(updatedAt)}
              </AppText>
            ) : null}

            <View style={[styles.chevron, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons
                name={
                  state === 'compact'
                    ? 'chevron-up'
                    : state === 'expanded'
                      ? 'chevron-down'
                      : 'remove'
                }
                size={16}
                color={theme.colors.textSecondary}
              />
            </View>
          </Pressable>
        </View>
      </GestureDetector>

      {state !== 'compact' ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {selected ? (
            <MapPointCard
              point={selected}
              onLeave={onClearSelection}
              onZoomIn={onZoomIn}
              onDirections={onDirections}
            />
          ) : loading && nearby.length === 0 ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color={theme.colors.primary} />
              <AppText variant="caption" color="textSecondary">
                Bu bölgedeki işaretler getiriliyor
              </AppText>
            </View>
          ) : error ? (
            <View style={styles.centerBox}>
              <Ionicons name="cloud-offline-outline" size={22} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textSecondary" align="center">
                {error}
              </AppText>
              <Pressable
                accessibilityRole="button"
                onPress={onRetry}
                style={[styles.retry, { borderColor: theme.colors.borderStrong }]}
              >
                <AppText variant="caption" color="primaryDeep">
                  Yeniden dene
                </AppText>
              </Pressable>
            </View>
          ) : nearby.length === 0 ? (
            <View style={styles.centerBox}>
              <Ionicons name="map-outline" size={22} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textSecondary" align="center">
                {MODE_EMPTY[mode]}
              </AppText>
            </View>
          ) : (
            <View style={styles.list}>
              {nearby.map((point) => {
                const tone = toneColor(theme, markerTone(point.kind));
                const avatar =
                  point.kind === 'friend'
                    ? (mediaPublicUrl('avatar', point.avatarPath) ?? point.avatarUrl ?? null)
                    : null;
                return (
                  <Pressable
                    key={`${point.kind}-${point.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${MAP_KIND_LABEL[point.kind]} ${point.title}`}
                    onPress={() => {
                      haptics.tap();
                      onSelectPoint(point);
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      {
                        backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                        borderColor: theme.colors.divider,
                      },
                    ]}
                  >
                    {point.kind === 'friend' ? (
                      <Avatar uri={avatar} name={point.title} size={34} />
                    ) : (
                      <View style={[styles.rowIcon, { backgroundColor: `${tone}1F` }]}>
                        <Ionicons
                          name={
                            point.kind === 'cluster' ? 'albums-outline' : MAP_KIND_ICON[point.kind]
                          }
                          size={16}
                          color={tone}
                        />
                      </View>
                    )}
                    <View style={styles.flex}>
                      <AppText variant="body" numberOfLines={1}>
                        {point.title}
                      </AppText>
                      <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                        {point.subtitle ?? MAP_KIND_LABEL[point.kind]}
                      </AppText>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 0,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  grabArea: { paddingTop: 7, paddingHorizontal: 14 },
  grabber: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10 },
  flex: { flex: 1 },
  chevron: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: { paddingHorizontal: 14, paddingBottom: 18, gap: 4 },
  list: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBox: { alignItems: 'center', gap: 8, paddingVertical: 22, paddingHorizontal: 12 },
  retry: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
