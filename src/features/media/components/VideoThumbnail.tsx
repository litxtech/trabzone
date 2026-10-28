import { Ionicons } from '@expo/vector-icons';
import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { AppImage, AppText } from '@/components/ui';
import { formatVideoDuration } from '@/features/media/video-service';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  /** Kapak görselinin URL'si (yerel dosya veya public storage yolu). */
  posterUri: string | null | undefined;
  durationMs?: number | null;
  /** Sağ üstte gösterilecek küçük etiket (örn. 1080p). */
  qualityLabel?: string | null;
  /** Sağ alt köşedeki süre etiketini gizle. */
  hideDuration?: boolean;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
};

/**
 * Video paylaşımlarında kullanılan önizleme: kapak karesi + oynatma rozeti.
 * Kapak yoksa nötr bir yer tutucu gösterilir; hiçbir durumda videoyu indirip
 * oynatmaya çalışmaz.
 */
export function VideoThumbnail({
  posterUri,
  durationMs,
  qualityLabel,
  hideDuration,
  style,
  imageStyle,
}: Props) {
  const { theme } = useTheme();
  const duration = hideDuration ? null : formatVideoDuration(durationMs);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.surfaceMuted }, style]}>
      {posterUri ? (
        <AppImage
          source={{ uri: posterUri }}
          style={[styles.poster, imageStyle]}
          recycleKey={posterUri}
        />
      ) : (
        <View style={styles.placeholder}>
          <Ionicons name="videocam" size={20} color={theme.colors.textSecondary} />
        </View>
      )}

      <View style={styles.scrim} pointerEvents="none" />
      <View style={styles.play}>
        <Ionicons name="play" size={18} color="#FFFFFF" style={styles.playIcon} />
      </View>

      {qualityLabel ? (
        <View style={styles.qualityBadge}>
          <AppText variant="caption" color="#FFFFFF">
            {qualityLabel}
          </AppText>
        </View>
      ) : null}

      {duration ? (
        <View style={styles.durationBadge}>
          <AppText variant="caption" color="#FFFFFF">
            {duration}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  poster: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(6,10,20,0.10)',
  },
  play: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(6,10,20,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  playIcon: { marginLeft: 2 },
  qualityBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(6,10,20,0.62)',
  },
  durationBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(6,10,20,0.62)',
  },
});
