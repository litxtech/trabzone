import { Ionicons } from '@expo/vector-icons';
import type { ImageContentFit } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui';
import { AppImage } from '@/components/ui/AppImage';
import { openUrl } from '@/features/in-app-browser';
import { publicMediaUrl } from '@/features/media/media-service';
import { useTheme } from '@/theme/ThemeProvider';

import { useExternalPlacePhoto, type PlacePhotoSize } from '../hooks/use-external-place-photo';

type Props = {
  /** İşletmenin Trabzone'daki kendi kapağı; varsa her zaman öncelikli. */
  coverPath: string | null | undefined;
  name: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
  size: PlacePhotoSize;
  style?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  recycleKey?: string | null;
  /**
   * Google fotoğrafı gösterilirken atıf biçimi. `badge`: köşede kısa "Google"
   * etiketi; `full`: fotoğraf sahibi + Google Maps, sahibin profiline bağlantı.
   */
  attribution?: 'badge' | 'full';
  /** Hiç görsel yokken gösterilecek içerik (ikon vb.). */
  fallback?: ReactNode;
};

/**
 * İşletme kapağı: önce Trabzone'a yüklenen kapak, yoksa Google Haritalar'daki
 * fotoğraf, o da yoksa `fallback`. Google fotoğrafında atıf zorunludur ve
 * kaldırılmamalıdır.
 */
export function PlaceCoverImage({
  coverPath,
  name,
  lat,
  lng,
  size,
  style,
  contentFit = 'cover',
  recycleKey,
  attribution = 'badge',
  fallback,
}: Props) {
  const { theme } = useTheme();
  const ownUrl = publicMediaUrl('place-media', coverPath);
  const external = useExternalPlacePhoto({ name, lat, lng, size, enabled: !ownUrl });
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const photo = !ownUrl && external.data && external.data.url !== failedUrl ? external.data : null;
  const uri = ownUrl ?? photo?.url ?? null;
  const author = photo?.attributions[0] ?? null;

  return (
    <View style={[styles.wrap, { backgroundColor: theme.colors.surfaceMuted }, style]}>
      {uri ? (
        <AppImage
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          recycleKey={recycleKey ?? uri}
          onError={() => {
            if (photo) {
              setFailedUrl(photo.url);
            }
          }}
        />
      ) : (
        fallback
      )}

      {photo && attribution === 'badge' ? (
        <View style={styles.badge} pointerEvents="none">
          <AppText variant="caption" style={styles.badgeText}>
            Google
          </AppText>
        </View>
      ) : null}

      {photo && attribution === 'full' ? (
        <Pressable
          accessibilityRole={author?.uri ? 'link' : 'text'}
          accessibilityLabel={`Fotoğraf: ${author ? `${author.name}, ` : ''}Google Maps`}
          disabled={!author?.uri}
          onPress={() => {
            if (author?.uri) {
              void openUrl(author.uri, { title: author.name });
            }
          }}
          style={styles.full}
        >
          <Ionicons name="camera-outline" size={12} color="#FFFFFF" />
          <AppText variant="caption" numberOfLines={1} style={styles.badgeText}>
            {author ? `${author.name} · Google Maps` : 'Google Maps'}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(6,12,24,0.6)',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, lineHeight: 14 },
  full: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    maxWidth: '70%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(6,12,24,0.6)',
  },
});
