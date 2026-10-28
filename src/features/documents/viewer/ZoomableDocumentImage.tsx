/* eslint-disable react-hooks/immutability -- Reanimated shared values gesture işleyicilerinde zorunlu olarak mutasyona uğrar. */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/ui';
import { haptics } from '@/utils/haptics';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

/** Görselin ekrana sığan (contain) taban ölçüsü. */
function fitInside(ratio: number, stageWidth: number, stageHeight: number) {
  'worklet';
  if (stageWidth <= 0 || stageHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 3 / 4;
  let width = stageWidth;
  let height = stageWidth / safeRatio;
  if (height > stageHeight) {
    height = stageHeight;
    width = stageHeight * safeRatio;
  }
  return { width, height };
}

type Props = {
  uri: string;
  /** Yükleme başarısız olduğunda çağrılır (imzalı bağlantı süresi dolmuş olabilir). */
  onError?: () => void;
  /** Görselin gerçek en-boy oranı biliniyorsa ilk karede zıplama olmaz. */
  aspectRatio?: number | null;
};

/**
 * Belge fotoğrafları için tam ekran yakınlaştırılabilir görsel.
 *
 * - Pinch ile 1x–5x, parmak merkezli yakınlaştırma
 * - Çift dokunuş ile 2.5x ↔ 1x
 * - Yakınlaştırılmışken sınırlı kaydırma
 * - Yükleniyor / hata / yeniden dene durumları
 *
 * Kimlik belgesi gibi küçük yazılı evrakların okunabilmesi için yakınlaştırma
 * zorunludur; bu yüzden görüntüleyici tarayıcıya devredilmez.
 */
export function ZoomableDocumentImage({ uri, onError, aspectRatio }: Props) {
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [ratio, setRatio] = useState(aspectRatio && aspectRatio > 0 ? aspectRatio : 3 / 4);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const base = useMemo(
    () => fitInside(ratio, stage.width, stage.height),
    [ratio, stage.height, stage.width],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStage((current) =>
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height },
    );
  }, []);

  const resetZoom = useCallback(
    (animated = true) => {
      'worklet';
      const config = { duration: animated ? 200 : 0 };
      scale.value = withTiming(MIN_SCALE, config);
      translateX.value = withTiming(0, config);
      translateY.value = withTiming(0, config);
      savedScale.value = MIN_SCALE;
      savedX.value = 0;
      savedY.value = 0;
      runOnJS(setZoom)(MIN_SCALE);
    },
    [savedScale, savedX, savedY, scale, translateX, translateY],
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          cancelAnimation(scale);
          savedScale.value = scale.value;
        })
        .onUpdate((event) => {
          const nextScale = clamp(savedScale.value * event.scale, MIN_SCALE, MAX_SCALE);
          scale.value = nextScale;
          const limitX = Math.max(
            0,
            (base.width * nextScale - Math.min(base.width, stage.width)) / 2,
          );
          const limitY = Math.max(
            0,
            (base.height * nextScale - Math.min(base.height, stage.height)) / 2,
          );
          translateX.value = clamp(translateX.value, -limitX, limitX);
          translateY.value = clamp(translateY.value, -limitY, limitY);
        })
        .onEnd(() => {
          if (scale.value <= MIN_SCALE + 0.02) {
            resetZoom(true);
            return;
          }
          savedScale.value = scale.value;
          savedX.value = translateX.value;
          savedY.value = translateY.value;
          runOnJS(setZoom)(scale.value);
        }),
    [
      base.height,
      base.width,
      resetZoom,
      savedScale,
      savedX,
      savedY,
      scale,
      stage.height,
      stage.width,
      translateX,
      translateY,
    ],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .minDistance(2)
        .onBegin(() => {
          savedX.value = translateX.value;
          savedY.value = translateY.value;
        })
        .onUpdate((event) => {
          if (scale.value <= MIN_SCALE + 0.01) {
            return;
          }
          const limitX = Math.max(
            0,
            (base.width * scale.value - Math.min(base.width, stage.width)) / 2,
          );
          const limitY = Math.max(
            0,
            (base.height * scale.value - Math.min(base.height, stage.height)) / 2,
          );
          translateX.value = clamp(savedX.value + event.translationX, -limitX, limitX);
          translateY.value = clamp(savedY.value + event.translationY, -limitY, limitY);
        })
        .onEnd(() => {
          savedX.value = translateX.value;
          savedY.value = translateY.value;
        }),
    [
      base.height,
      base.width,
      savedX,
      savedY,
      scale,
      stage.height,
      stage.width,
      translateX,
      translateY,
    ],
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(240)
        .onEnd((event) => {
          if (scale.value > MIN_SCALE + 0.05) {
            resetZoom(true);
            return;
          }
          const targetScale = DOUBLE_TAP_SCALE;
          const contentX = (event.x - stage.width / 2 - translateX.value) / scale.value;
          const contentY = (event.y - stage.height / 2 - translateY.value) / scale.value;
          const targetX = event.x - stage.width / 2 - contentX * targetScale;
          const targetY = event.y - stage.height / 2 - contentY * targetScale;
          const limitX = Math.max(
            0,
            (base.width * targetScale - Math.min(base.width, stage.width)) / 2,
          );
          const limitY = Math.max(
            0,
            (base.height * targetScale - Math.min(base.height, stage.height)) / 2,
          );
          scale.value = withTiming(targetScale, { duration: 220 });
          translateX.value = withTiming(clamp(targetX, -limitX, limitX), { duration: 220 });
          translateY.value = withTiming(clamp(targetY, -limitY, limitY), { duration: 220 });
          savedScale.value = targetScale;
          savedX.value = clamp(targetX, -limitX, limitX);
          savedY.value = clamp(targetY, -limitY, limitY);
          runOnJS(setZoom)(targetScale);
        }),
    [
      base.height,
      base.width,
      resetZoom,
      savedScale,
      savedX,
      savedY,
      scale,
      stage.height,
      stage.width,
      translateX,
      translateY,
    ],
  );

  const composed = useMemo(
    () => Gesture.Simultaneous(pinch, pan, doubleTap),
    [doubleTap, pan, pinch],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={styles.root} onLayout={handleLayout}>
      <GestureDetector gesture={composed}>
        <View style={styles.stage}>
          {base.width > 0 ? (
            <Animated.View style={[{ width: base.width, height: base.height }, animatedStyle]}>
              {!failed ? (
                <Image
                  source={{ uri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  transition={120}
                  onLoadStart={() => {
                    setLoading(true);
                    setFailed(false);
                  }}
                  onLoad={(event) => {
                    setLoading(false);
                    const source = event.source;
                    const nextRatio =
                      source && source.width > 0 && source.height > 0
                        ? source.width / source.height
                        : null;
                    if (nextRatio && Math.abs(nextRatio - ratio) > 0.01) {
                      setRatio(nextRatio);
                    }
                  }}
                  onError={() => {
                    setLoading(false);
                    setFailed(true);
                    onError?.();
                  }}
                />
              ) : null}
              {loading && !failed ? (
                <ActivityIndicator
                  color="rgba(255,255,255,0.85)"
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
              ) : null}
            </Animated.View>
          ) : null}
        </View>
      </GestureDetector>

      <View pointerEvents="none" style={styles.hint}>
        <Ionicons name="scan-outline" size={12} color="rgba(255,255,255,0.82)" />
        <AppText variant="caption" color="rgba(255,255,255,0.82)">
          İki parmakla yakınlaştır · çift dokunuş
        </AppText>
      </View>

      {zoom > MIN_SCALE + 0.05 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Yakınlaştırmayı sıfırla"
          onPress={() => {
            haptics.tap();
            resetZoom(true);
          }}
          style={({ pressed }) => [styles.reset, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="contract-outline" size={13} color="#FFFFFF" />
          <AppText variant="caption" color="#FFFFFF">
            {zoom.toFixed(1)}x
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(4,8,18,0.55)',
  },
  reset: {
    position: 'absolute',
    right: 14,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});
