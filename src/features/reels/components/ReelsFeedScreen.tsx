import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { useReelsFeed } from '../hooks/use-reels';
import type { Reel } from '../services/reels-service';
import { ReelCommentsSheet } from './ReelCommentsSheet';
import { ReelEditSheet } from './ReelEditSheet';
import { ReelItem } from './ReelItem';

export function ReelsFeedScreen() {
  const { theme, scheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data, isLoading, isError, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useReelsFeed();

  const reels = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  const listRef = useRef<FlatList<Reel>>(null);
  const [height, setHeight] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Sekme odakta degilken (onceden kurulmus olsa bile) hicbir video oynamamali.
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [muted, setMuted] = useState(false);
  const [commentsId, setCommentsId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Uygulama arkaya gittiğinde ses devam etmesin (eski derlemelerde de geçerli).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (focused) {
      setStatusBarStyle('light');
      return;
    }
    setStatusBarStyle(scheme === 'dark' ? 'light' : 'dark');
  }, [focused, scheme]);

  const activeIndex = useMemo(
    () => reels.findIndex((reel) => reel.id === activeId),
    [activeId, reels],
  );

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) {
      return;
    }
    if (activeIndex >= reels.length - 2) {
      void fetchNextPage();
    }
  }, [activeIndex, fetchNextPage, hasNextPage, isFetchingNextPage, reels.length]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { isViewable: boolean; item: Reel }[] }) => {
      const first = viewableItems.find((item) => item.isViewable && item.item);
      if (first?.item?.id) {
        setActiveId(first.item.id);
      }
    },
    [],
  );

  const viewabilityConfig = useMemo(
    () => ({
      viewAreaCoveragePercentThreshold: 55,
      minimumViewTime: 80,
    }),
    [],
  );

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (height <= 0) {
        return;
      }
      const index = Math.round(event.nativeEvent.contentOffset.y / height);
      const reel = reels[index];
      if (reel) {
        setActiveId(reel.id);
      }
    },
    [height, reels],
  );

  const openComments = useCallback((reel: Reel) => {
    haptics.tap();
    setCommentsId(reel.id);
  }, []);

  const openEditor = useCallback((reel: Reel) => {
    setEditingId(reel.id);
  }, []);

  const onDeleted = useCallback(() => {
    setActiveId(null);
    setCommentsId(null);
    setEditingId(null);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const commentsReel = reels.find((reel) => reel.id === commentsId) ?? null;
  const editingReel = reels.find((reel) => reel.id === editingId) ?? null;

  const renderItem = useCallback(
    ({ item }: { item: Reel }) => (
      <ReelItem
        reel={item}
        active={focused && appActive && item.id === activeId}
        muted={muted}
        height={height}
        onOpenComments={openComments}
        onEdit={openEditor}
        onDeleted={onDeleted}
      />
    ),
    [activeId, appActive, focused, height, muted, onDeleted, openComments, openEditor],
  );

  const header = (
    <View style={[styles.topBar, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
      <View style={styles.brand}>
        <AppText variant="h2" color="#FFFFFF" style={styles.title}>
          Reels
        </AppText>
        <View style={styles.brandDot} />
      </View>
      <View style={styles.topActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Sesi aç' : 'Sesi kapat'}
          hitSlop={8}
          onPress={() => {
            haptics.tap();
            setMuted((value) => !value);
          }}
          style={styles.topButton}
        >
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={21} color="#FFFFFF" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reels oluştur"
          hitSlop={8}
          onPress={() => router.push('/compose/reel' as never)}
          style={styles.topButton}
        >
          <Ionicons name="videocam-outline" size={23} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View
      style={[styles.root, { backgroundColor: '#000000' }]}
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.height);
        if (next > 0 && next !== height) {
          setHeight(next);
        }
      }}
    >
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : isError && reels.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={32} color="rgba(255,255,255,0.7)" />
          <AppText variant="h3" color="#FFFFFF" align="center">
            Reels yüklenemedi
          </AppText>
          <AppText variant="body" color="rgba(255,255,255,0.65)" align="center">
            Bağlantını kontrol edip tekrar dene.
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tekrar dene"
            onPress={() => void refetch()}
            style={({ pressed }) => [styles.retry, { opacity: pressed ? 0.7 : 1 }]}
          >
            <AppText variant="label" color="#0B1020">
              Tekrar dene
            </AppText>
          </Pressable>
        </View>
      ) : reels.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="play-circle-outline" size={30} color="#FFFFFF" />
          </View>
          <AppText variant="h3" color="#FFFFFF" align="center">
            Henüz Reels yok
          </AppText>
          <AppText variant="body" color="rgba(255,255,255,0.65)" align="center">
            İlk dikey videonu paylaş, keşfet akışını başlat.
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reels oluştur"
            onPress={() => router.push('/compose/reel' as never)}
            style={({ pressed }) => [
              styles.createButton,
              { backgroundColor: theme.colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Ionicons name="add" size={18} color={theme.colors.onPrimary} />
            <AppText variant="label" color="onPrimary">
              Reels oluştur
            </AppText>
          </Pressable>
        </View>
      ) : height > 0 ? (
        <FlatList
          keyboardShouldPersistTaps="handled"
          ref={listRef}
          data={reels}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          snapToInterval={height}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({
            length: height,
            offset: height * index,
            index,
          })}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={3}
          // Android'de kirpilan ogeler video yuzeyini yok ediyor; ses devam
          // ederken goruntu kayboluyordu.
          removeClippedSubviews={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onMomentumScrollEnd={onMomentumScrollEnd}
        />
      ) : null}

      {reels.length > 0 ? header : null}

      <ReelCommentsSheet
        visible={Boolean(commentsReel)}
        reelId={commentsReel?.id ?? ''}
        commentCount={commentsReel?.comment_count ?? 0}
        onClose={() => setCommentsId(null)}
      />

      <ReelEditSheet
        key={editingReel?.id ?? 'none'}
        visible={Boolean(editingReel)}
        reel={editingReel}
        onClose={() => setEditingId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 36,
  },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { letterSpacing: 0.3, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 },
  brandDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#7AA2FF',
    marginTop: 4,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,12,22,0.34)',
  },
  retry: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 4,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    marginTop: 8,
  },
});
