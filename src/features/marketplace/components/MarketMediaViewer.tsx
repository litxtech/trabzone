/* eslint-disable react-hooks/immutability -- Reanimated shared values gesture işleyicilerinde zorunlu olarak mutasyona uğrar. */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, IconButton } from '@/components/ui';
import { haptics } from '@/utils/haptics';

export type MarketMediaViewerItem = {
  id: string;
  kind: 'image' | 'video';
  uri: string;
  thumbUri?: string | null;
  width?: number | null;
  height?: number | null;
};

export type MarketMediaViewerProps = {
  visible: boolean;
  items: MarketMediaViewerItem[];
  initialIndex?: number;
  onClose: () => void;
  footer?: React.ReactNode;
};

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const EDGE_SWIPE_THRESHOLD = 88;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

/**
 * TRABZONE ortak tam ekran medya görüntüleyici.
 *
 * - Yatay kaydırma ile fotoğraf geçişi (yakınlaştırma yokken)
 * - Pinch zoom (1x–4x, parmak merkezli)
 * - Çift dokunuş ile 2.5x ↔ 1x
 * - Yakınlaştırılmışken sınırlı pan; kenarda kontrollü komşu fotoğrafa geçiş
 * - Yüksek çözünürlük kaynağı + düşük çözünürlük placeholder (siyah flash yok)
 * - Komşu görselleri ön yükleme, sanallaştırılmış galeri
 */
export function MarketMediaViewer({
  visible,
  items,
  initialIndex = 0,
  onClose,
  footer,
}: MarketMediaViewerProps) {
  if (!items.length) {
    return null;
  }
  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      presentationStyle="fullScreen"
    >
      <GestureHandlerRootView style={styles.flex}>
        <MarketMediaViewerContent
          key={`viewer-${initialIndex}`}
          items={items}
          initialIndex={initialIndex}
          onClose={onClose}
          footer={footer}
        />
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * Modal'sız sürüm. Yorum/profil gibi birden fazla katmanın tek bir native Modal
 * içinde yaşadığı akışlarda kullanılır (iOS'ta iç içe Modal açılamaz).
 */
export function MarketMediaViewerContent({
  items,
  initialIndex = 0,
  onClose,
  footer,
}: {
  items: MarketMediaViewerItem[];
  initialIndex?: number;
  onClose: () => void;
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const listRef = useRef<FlatList<MarketMediaViewerItem>>(null);
  const safeStart = Math.min(Math.max(initialIndex, 0), items.length - 1);
  const [index, setIndex] = useState(safeStart);
  const [zoomed, setZoomed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [filmstripVisible, setFilmstripVisible] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const active = items[index];

  // Komşu görselleri önceden yükle: geçişte boş/ siyah kare oluşmaz.
  useEffect(() => {
    const neighbors = [items[index - 1], items[index + 1], items[index + 2]].filter(
      (item): item is MarketMediaViewerItem => Boolean(item?.uri),
    );
    neighbors.forEach((item) => {
      void Image.prefetch(item.uri, 'memory-disk');
      if (item.thumbUri) {
        void Image.prefetch(item.thumbUri, 'memory-disk');
      }
    });
    const thumbs = items.slice(Math.max(0, index - 1), index + 2);
    thumbs.forEach((item) => {
      if (item.thumbUri) {
        void Image.prefetch(item.thumbUri, 'memory-disk');
      }
    });
  }, [index, items]);

  const goToIndex = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), items.length - 1);
      if (clamped === index) {
        return;
      }
      haptics.selection();
      setZoomed(false);
      setScrollEnabled(true);
      setIndex(clamped);
      listRef.current?.scrollToOffset({ offset: clamped * width, animated: false });
    },
    [index, items.length, width],
  );

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1));
      if (next !== index) {
        setZoomed(false);
        setScrollEnabled(true);
        setIndex(Math.min(Math.max(next, 0), items.length - 1));
      }
    },
    [index, items.length, width],
  );

  const renderItem = useCallback(
    ({ item, index: pageIndex }: { item: MarketMediaViewerItem; index: number }) => (
      <View style={{ width, height }}>
        {item.kind === 'video' ? (
          <MarketFullscreenVideo item={item} active={pageIndex === index} />
        ) : (
          <ZoomableMarketImage
            item={item}
            width={width}
            height={height}
            active={pageIndex === index}
            onZoomChange={(value) => {
              if (pageIndex === index) {
                setZoomed(value);
                setScrollEnabled(!value);
              }
            }}
            onToggleControls={() => setControlsVisible((current) => !current)}
            onEdgeSwipe={(direction) => {
              goToIndex(direction === 'next' ? index + 1 : index - 1);
            }}
          />
        )}
      </View>
    ),
    [goToIndex, height, index, width],
  );

  const keyExtractor = useCallback((item: MarketMediaViewerItem) => item.id, []);

  return (
    <View style={styles.root}>
      <FlatList
        keyboardShouldPersistTaps="handled"
        ref={listRef}
        data={items}
        horizontal
        pagingEnabled
        scrollEnabled={scrollEnabled}
        showsHorizontalScrollIndicator={false}
        bounces={false}
        initialScrollIndex={safeStart}
        getItemLayout={(_, itemIndex) => ({
          length: width,
          offset: width * itemIndex,
          index: itemIndex,
        })}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onMomentumScrollEnd={handleMomentumEnd}
        extraData={index}
      />

      {controlsVisible ? (
        <>
          <View
            style={[
              styles.topBar,
              { paddingTop: insets.top + 6, backgroundColor: 'rgba(4,8,18,0.28)' },
            ]}
          >
            <IconButton
              name="close"
              accessibilityLabel="Kapat"
              variant="glass"
              size={19}
              color="#FFFFFF"
              onPress={onClose}
            />
            <View style={styles.topCenter}>
              <AppText variant="label" color="#FFFFFF">
                {items.length > 1 ? `${index + 1} / ${items.length}` : '1 / 1'}
              </AppText>
              {active?.kind === 'video' ? (
                <View style={styles.videoPill}>
                  <Ionicons name="videocam" size={11} color="#FFFFFF" />
                  <AppText variant="caption" color="#FFFFFF">
                    Video
                  </AppText>
                </View>
              ) : null}
            </View>
            <IconButton
              name={filmstripVisible ? 'chevron-down' : 'grid-outline'}
              accessibilityLabel={filmstripVisible ? 'Önizlemeleri gizle' : 'Önizlemeleri göster'}
              variant="glass"
              size={18}
              color="#FFFFFF"
              onPress={() => setFilmstripVisible((current) => !current)}
            />
          </View>

          {zoomed ? (
            <View pointerEvents="none" style={[styles.zoomHint, { top: insets.top + 62 }]}>
              <Ionicons name="scan-outline" size={12} color="rgba(255,255,255,0.9)" />
              <AppText variant="caption" color="rgba(255,255,255,0.9)">
                {MAX_SCALE}x’e kadar yakınlaştırma
              </AppText>
            </View>
          ) : null}
        </>
      ) : null}

      {controlsVisible && items.length > 1 ? (
        <View
          style={[
            styles.bottomArea,
            { paddingBottom: insets.bottom + (filmstripVisible ? 12 : 18) },
          ]}
        >
          {filmstripVisible ? (
            <FlatList
              keyboardShouldPersistTaps="handled"
              data={items}
              horizontal
              keyExtractor={keyExtractor}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filmstrip}
              renderItem={({ item, index: thumbIndex }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${thumbIndex + 1}. medya`}
                  onPress={() => goToIndex(thumbIndex)}
                  style={[
                    styles.thumb,
                    {
                      borderColor: thumbIndex === index ? '#FFFFFF' : 'rgba(255,255,255,0.18)',
                    },
                  ]}
                >
                  <Image
                    source={{ uri: item.thumbUri ?? item.uri }}
                    style={styles.thumbImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={100}
                  />
                  {item.kind === 'video' ? (
                    <View style={styles.thumbPlay}>
                      <Ionicons name="play" size={12} color="#FFFFFF" />
                    </View>
                  ) : null}
                </Pressable>
              )}
            />
          ) : null}
          {footer}
          <View style={styles.dots}>
            {items.slice(0, Math.min(items.length, 9)).map((item, dotIndex) => (
              <View
                key={`dot-${item.id}`}
                style={[
                  styles.dot,
                  {
                    backgroundColor: dotIndex === index ? '#FFFFFF' : 'rgba(255,255,255,0.32)',
                    width: dotIndex === index ? 18 : 6,
                  },
                ]}
              />
            ))}
            {items.length > 9 ? (
              <AppText variant="caption" color="rgba(255,255,255,0.65)">
                +{items.length - 9}
              </AppText>
            ) : null}
          </View>
        </View>
      ) : null}

      {!controlsVisible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kontrolleri göster"
          onPress={() => setControlsVisible(true)}
          style={[styles.showControls, { top: insets.top + 10 }]}
        >
          <Ionicons name="ellipsis-horizontal" size={16} color="#FFFFFF" />
        </Pressable>
      ) : null}

      <View
        pointerEvents="none"
        style={[
          styles.counterChip,
          { bottom: insets.bottom + 12, opacity: controlsVisible ? 0 : 1 },
        ]}
      >
        <AppText variant="caption" color="#FFFFFF">
          {index + 1} / {items.length}
        </AppText>
      </View>
    </View>
  );
}

function ZoomableMarketImage({
  item,
  width,
  height,
  active,
  onZoomChange,
  onToggleControls,
  onEdgeSwipe,
}: {
  item: MarketMediaViewerItem;
  width: number;
  height: number;
  active: boolean;
  onZoomChange: (zoomed: boolean) => void;
  onToggleControls: () => void;
  onEdgeSwipe: (direction: 'prev' | 'next') => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const isZoomed = useSharedValue(false);
  const edgeDirection = useSharedValue(0);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [panEnabled, setPanEnabled] = useState(false);

  const notifyZoom = useCallback(
    (value: boolean) => {
      setPanEnabled(value);
      onZoomChange(value);
    },
    [onZoomChange],
  );

  const ratio = useMemo(() => {
    const candidate = (item.width ?? 0) / (item.height ?? 0);
    return Number.isFinite(candidate) && candidate > 0 ? candidate : 4 / 3;
  }, [item.height, item.width]);

  // Görselin ekrana sığan (contain) taban ölçüsü.
  const base = useMemo(() => {
    let baseWidth = width;
    let baseHeight = width / ratio;
    if (baseHeight > height) {
      baseHeight = height;
      baseWidth = height * ratio;
    }
    return { width: baseWidth, height: baseHeight };
  }, [height, ratio, width]);

  const resetZoom = useCallback(
    (animated: boolean) => {
      'worklet';
      const config = { duration: animated ? 200 : 0 };
      scale.value = withTiming(1, config);
      translateX.value = withTiming(0, config);
      translateY.value = withTiming(0, config);
      savedScale.value = 1;
      savedX.value = 0;
      savedY.value = 0;
      isZoomed.value = false;
      edgeDirection.value = 0;
      runOnJS(notifyZoom)(false);
    },
    [
      edgeDirection,
      isZoomed,
      notifyZoom,
      savedScale,
      savedX,
      savedY,
      scale,
      translateX,
      translateY,
    ],
  );

  useEffect(() => {
    if (!active) {
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedScale.value = 1;
      savedX.value = 0;
      savedY.value = 0;
      isZoomed.value = false;
      edgeDirection.value = 0;
      // Görüntüleyici pasife indiğinde yükleme durumu sıfırlanır.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(false);
      setLoading(true);
      setPanEnabled(false);
    }
  }, [active, edgeDirection, isZoomed, savedScale, savedX, savedY, scale, translateX, translateY]);

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin((event) => {
          savedScale.value = scale.value;
          savedX.value = translateX.value;
          savedY.value = translateY.value;
          const startContentX =
            (event.focalX - width / 2 - savedX.value) / Math.max(savedScale.value, 0.01);
          const startContentY =
            (event.focalY - height / 2 - savedY.value) / Math.max(savedScale.value, 0.01);
          // Focal noktasını korumak için başlangıç içerik koordinatını sakla.
          savedX.value = startContentX;
          savedY.value = startContentY;
        })
        .onUpdate((event) => {
          const nextScale = clamp(savedScale.value * event.scale, 1, MAX_SCALE);
          scale.value = nextScale;
          const targetX = event.focalX - width / 2 - savedX.value * nextScale;
          const targetY = event.focalY - height / 2 - savedY.value * nextScale;
          const limitX = Math.max(0, (base.width * nextScale - Math.min(base.width, width)) / 2);
          const limitY = Math.max(0, (base.height * nextScale - Math.min(base.height, height)) / 2);
          translateX.value = clamp(targetX, -limitX, limitX);
          translateY.value = clamp(targetY, -limitY, limitY);
          isZoomed.value = nextScale > 1.01;
        })
        .onEnd(() => {
          if (scale.value <= 1.02) {
            resetZoom(true);
            return;
          }
          const limitX = Math.max(0, (base.width * scale.value - Math.min(base.width, width)) / 2);
          const limitY = Math.max(
            0,
            (base.height * scale.value - Math.min(base.height, height)) / 2,
          );
          translateX.value = withTiming(clamp(translateX.value, -limitX, limitX), {
            duration: 140,
          });
          translateY.value = withTiming(clamp(translateY.value, -limitY, limitY), {
            duration: 140,
          });
          savedScale.value = scale.value;
          savedX.value = translateX.value;
          savedY.value = translateY.value;
          isZoomed.value = true;
          runOnJS(notifyZoom)(true);
        }),
    [
      base.height,
      base.width,
      height,
      isZoomed,
      notifyZoom,
      resetZoom,
      savedScale,
      savedX,
      savedY,
      scale,
      translateX,
      translateY,
      width,
    ],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(active && panEnabled)
        .maxPointers(1)
        .minDistance(2)
        .onBegin(() => {
          savedX.value = translateX.value;
          savedY.value = translateY.value;
          edgeDirection.value = 0;
        })
        .onUpdate((event) => {
          if (scale.value <= 1.01) {
            return;
          }
          const limitX = Math.max(0, (base.width * scale.value - Math.min(base.width, width)) / 2);
          const limitY = Math.max(
            0,
            (base.height * scale.value - Math.min(base.height, height)) / 2,
          );
          const rawX = savedX.value + event.translationX;
          const rawY = savedY.value + event.translationY;
          translateX.value = clamp(rawX, -limitX, limitX);
          translateY.value = clamp(rawY, -limitY, limitY);

          if (rawX > limitX + EDGE_SWIPE_THRESHOLD && Math.abs(event.translationY) < 140) {
            edgeDirection.value = -1;
          } else if (rawX < -limitX - EDGE_SWIPE_THRESHOLD && Math.abs(event.translationY) < 140) {
            edgeDirection.value = 1;
          }
        })
        .onEnd(() => {
          const direction = edgeDirection.value;
          edgeDirection.value = 0;
          if (direction !== 0 && scale.value <= 2.2) {
            runOnJS(onEdgeSwipe)(direction === 1 ? 'next' : 'prev');
            return;
          }
          savedX.value = translateX.value;
          savedY.value = translateY.value;
        }),
    [
      active,
      base.height,
      base.width,
      edgeDirection,
      height,
      onEdgeSwipe,
      panEnabled,
      savedX,
      savedY,
      scale,
      translateX,
      translateY,
      width,
    ],
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(240)
        .onEnd((event) => {
          if (scale.value > 1.05) {
            resetZoom(true);
            return;
          }
          const targetScale = DOUBLE_TAP_SCALE;
          const contentX = (event.x - width / 2 - translateX.value) / scale.value;
          const contentY = (event.y - height / 2 - translateY.value) / scale.value;
          const targetX = event.x - width / 2 - contentX * targetScale;
          const targetY = event.y - height / 2 - contentY * targetScale;
          const limitX = Math.max(0, (base.width * targetScale - Math.min(base.width, width)) / 2);
          const limitY = Math.max(
            0,
            (base.height * targetScale - Math.min(base.height, height)) / 2,
          );
          scale.value = withTiming(targetScale, { duration: 220 });
          translateX.value = withTiming(clamp(targetX, -limitX, limitX), { duration: 220 });
          translateY.value = withTiming(clamp(targetY, -limitY, limitY), { duration: 220 });
          savedScale.value = targetScale;
          savedX.value = clamp(targetX, -limitX, limitX);
          savedY.value = clamp(targetY, -limitY, limitY);
          isZoomed.value = true;
          runOnJS(notifyZoom)(true);
        }),
    [
      base.height,
      base.width,
      height,
      isZoomed,
      notifyZoom,
      resetZoom,
      savedScale,
      savedX,
      savedY,
      scale,
      translateX,
      translateY,
      width,
    ],
  );

  const singleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDuration(250)
        .onEnd(() => {
          runOnJS(onToggleControls)();
        }),
    [onToggleControls],
  );

  const composed = useMemo(
    () => Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap)),
    [doubleTap, pan, pinch, singleTap],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <View style={styles.imageStage}>
        <Animated.View style={[{ width: base.width, height: base.height }, animatedStyle]}>
          {item.thumbUri ? (
            <Image
              source={{ uri: item.thumbUri }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              cachePolicy="memory-disk"
              blurRadius={0}
            />
          ) : null}
          {!failed ? (
            <Image
              key={`${item.id}-${attempt}`}
              source={{ uri: item.uri }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              transition={0}
              cachePolicy="memory-disk"
              recyclingKey={item.id}
              onLoadStart={() => setLoading(true)}
              onLoad={() => {
                setLoading(false);
                setFailed(false);
              }}
              onError={() => {
                setLoading(false);
                setFailed(true);
              }}
            />
          ) : null}
          {loading && !failed ? (
            <ActivityIndicator
              color="rgba(255,255,255,0.85)"
              style={styles.loadingIndicator}
              pointerEvents="none"
            />
          ) : null}
          {failed ? (
            <View style={styles.errorOverlay}>
              <View style={styles.errorIcon}>
                <Ionicons name="image-outline" size={26} color="rgba(255,255,255,0.85)" />
              </View>
              <AppText variant="caption" color="rgba(255,255,255,0.8)" align="center">
                Fotoğraf yüklenemedi.
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Yeniden dene"
                onPress={() => {
                  setFailed(false);
                  setLoading(true);
                  setAttempt((current) => current + 1);
                }}
                style={({ pressed }) => [
                  styles.retryButton,
                  { opacity: pressed ? 0.7 : 1, borderColor: 'rgba(255,255,255,0.35)' },
                ]}
              >
                <Ionicons name="refresh" size={14} color="#FFFFFF" />
                <AppText variant="caption" color="#FFFFFF">
                  Yeniden dene
                </AppText>
              </Pressable>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

function MarketFullscreenVideo({ item, active }: { item: MarketMediaViewerItem; active: boolean }) {
  const player = useVideoPlayer(item.uri, (instance) => {
    instance.loop = false;
    instance.muted = false;
    instance.timeUpdateEventInterval = 0.5;
  });

  useEffect(() => {
    if (!active) {
      try {
        player.pause();
      } catch {
        // Oynatıcı zaten serbest bırakılmış olabilir.
      }
      return;
    }
    try {
      player.play();
    } catch {
      // Otomatik oynatma engellenmiş olabilir; kullanıcı kontrolleri kullanır.
    }
  }, [active, player]);

  return (
    <View style={styles.videoStage}>
      {item.thumbUri ? (
        <Image
          source={{ uri: item.thumbUri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      ) : null}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls
        surfaceType="textureView"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: '#04060C' },
  imageStage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  videoStage: { flex: 1, backgroundColor: '#000000' },
  loadingIndicator: { position: 'absolute' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  topCenter: { alignItems: 'center', gap: 2 },
  videoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  zoomHint: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(4,8,18,0.45)',
  },
  bottomArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    paddingHorizontal: 14,
    gap: 10,
    backgroundColor: 'rgba(4,8,18,0.32)',
  },
  filmstrip: { gap: 8, paddingVertical: 2 },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 9,
    borderWidth: 1.5,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbPlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  dots: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 5, height: 18 },
  dot: { height: 6, borderRadius: 3 },
  showControls: {
    position: 'absolute',
    alignSelf: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  counterChip: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(4,8,18,0.5)',
  },
  errorOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(4,6,12,0.55)',
  },
  errorIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
});
