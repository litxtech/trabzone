import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { AppText } from '@/components/ui';
import { StorageImage } from '@/features/explore/components/StorageImage';
import { useTheme } from '@/theme/ThemeProvider';

import type { PharmacyPhoto } from '../types';

/**
 * Eczane galerisi.
 *
 * Yalnızca moderasyondan geçmiş gerçek fotoğraflar gösterilir. Fotoğraf yoksa
 * stok görsel kullanılmaz: bunun yerine "henüz fotoğraf yok" denir ve
 * kullanıcıya kendi fotoğrafını ekleme yolu sunulur.
 */
export function PharmacyGallery({
  photos,
  coverPath,
  onAddPhoto,
}: {
  photos: PharmacyPhoto[];
  coverPath: string | null;
  onAddPhoto?: () => void;
}) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);

  const frameWidth = Math.min(width, 720) - 36;
  const paths = photos
    .map((photo) => photo.storage_path ?? photo.thumb_path)
    .filter((path): path is string => Boolean(path));
  const gallery = paths.length ? paths : coverPath ? [coverPath] : [];

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (frameWidth <= 0) {
      return;
    }
    const next = Math.round(event.nativeEvent.contentOffset.x / frameWidth);
    setIndex((current) => (next === current ? current : Math.max(0, Math.min(next, gallery.length - 1))));
  };

  if (gallery.length === 0) {
    return (
      <LinearGradient
        colors={[theme.colors.primarySoft, theme.colors.surfaceMuted]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.cover, { borderColor: theme.colors.border }]}
      >
        <Ionicons
          name="medkit"
          size={124}
          color={`${theme.colors.primary}1f`}
          style={styles.watermark}
        />
        <View style={styles.coverText}>
          <AppText variant="overline" color="primaryDeep">
            ECZANE FOTOĞRAFI
          </AppText>
          <AppText variant="title">Henüz fotoğraf eklenmedi</AppText>
          <AppText variant="caption" color="textSecondary">
            Eczanenin fotoğrafını paylaşarak diğer kullanıcılara yardımcı olabilirsin. Yüklenen
            fotoğraflar yayına alınmadan önce incelenir.
          </AppText>
        </View>
        {onAddPhoto ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Eczane fotoğrafı ekle"
            onPress={onAddPhoto}
            style={({ pressed }) => [
              styles.addButton,
              {
                backgroundColor: theme.colors.primaryDeep,
                borderColor: theme.colors.primaryDeep,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons name="camera" size={15} color={theme.colors.onPrimary} />
            <AppText variant="caption" style={{ color: theme.colors.onPrimary, fontWeight: '700' }}>
              Fotoğraf ekle
            </AppText>
          </Pressable>
        ) : (
          <AppText variant="caption" color="textTertiary">
            Fotoğraf eklemek için giriş yapmalısın.
          </AppText>
        )}
      </LinearGradient>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        onScrollEndDrag={onScroll}
        scrollEventThrottle={16}
        style={{ width: frameWidth, borderRadius: 22 }}
      >
        {gallery.map((path, photoIndex) => (
          <View key={`${path}-${photoIndex}`} style={{ width: frameWidth }}>
            <StorageImage
              path={path}
              bucket="place-media"
              style={styles.image}
              recycleKey={`${path}-${photoIndex}`}
            />
          </View>
        ))}
      </ScrollView>

      {gallery.length > 1 ? (
        <View style={styles.dots}>
          {gallery.map((_, dotIndex) => (
            <View
              key={dotIndex}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    dotIndex === index ? theme.colors.primaryDeep : theme.colors.borderStrong,
                },
              ]}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.badges}>
        <View style={[styles.photoCount, { backgroundColor: theme.colors.glass }]}>
          <Ionicons name="images-outline" size={12} color={theme.colors.text} />
          <AppText variant="caption" style={{ fontWeight: '700' }}>
            {gallery.length} fotoğraf
          </AppText>
        </View>
        {onAddPhoto ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Eczane fotoğrafı ekle"
            onPress={onAddPhoto}
            style={({ pressed }) => [
              styles.photoCount,
              { backgroundColor: theme.colors.glass, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Ionicons name="camera-outline" size={12} color={theme.colors.text} />
            <AppText variant="caption" style={{ fontWeight: '700' }}>
              Fotoğraf ekle
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  flex: { flex: 1 },
  image: { width: '100%', height: 208, borderRadius: 22 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badges: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    gap: 6,
  },
  photoCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  cover: {
    minHeight: 176,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    justifyContent: 'flex-end',
    gap: 12,
    overflow: 'hidden',
  },
  watermark: { position: 'absolute', right: -14, top: -18 },
  coverText: { gap: 3 },
  addButton: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
