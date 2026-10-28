import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, IconButton } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export type ViewerMedia = {
  id: string;
  uri: string;
  media_type: 'image' | 'video';
};

function ViewerVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.play();
  });

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls
      surfaceType="textureView"
    />
  );
}

type MediaViewerProps = {
  visible: boolean;
  media: ViewerMedia[];
  startIndex?: number;
  onClose: () => void;
};

/** Feed ve profil galerilerinde kullanilan tam ekran medya goruntuleyici. */
export function MediaViewer({ visible, media, startIndex = 0, onClose }: MediaViewerProps) {
  if (!media[startIndex]) {
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Acilis aninda (visible / startIndex degisimi) durumu sifirlamak icin key kullanilir. */}
      <MediaViewerStage
        key={`${visible ? 'open' : 'closed'}-${startIndex}`}
        media={media}
        startIndex={startIndex}
        onClose={onClose}
      />
    </Modal>
  );
}

function MediaViewerStage({
  media,
  startIndex,
  onClose,
}: {
  media: ViewerMedia[];
  startIndex: number;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(startIndex);
  const [loading, setLoading] = useState(true);

  const item = media[index];
  if (!item) {
    return null;
  }

  return (
    <>
      <View style={[styles.root, { backgroundColor: '#000000' }]}>
        <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
          <AppText variant="label" color="#FFFFFF">
            {media.length > 1 ? `${index + 1} / ${media.length}` : ''}
          </AppText>
          <IconButton
            name="close"
            accessibilityLabel="Kapat"
            variant="glass"
            size={19}
            color="#FFFFFF"
            onPress={onClose}
          />
        </View>

        <View style={styles.stage}>
          {item.media_type === 'video' ? (
            <ViewerVideo uri={item.uri} />
          ) : (
            <>
              <Image
                source={{ uri: item.uri }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                transition={150}
                cachePolicy="memory-disk"
                onLoadEnd={() => setLoading(false)}
              />
              {loading ? (
                <ActivityIndicator color="#FFFFFF" style={StyleSheet.absoluteFill} />
              ) : null}
            </>
          )}
        </View>

        {media.length > 1 ? (
          <View style={[styles.nav, { paddingBottom: insets.bottom + 16 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Önceki medya"
              disabled={index === 0}
              onPress={() => {
                setLoading(true);
                setIndex((current) => Math.max(0, current - 1));
              }}
              style={({ pressed }) => [
                styles.navButton,
                { opacity: index === 0 ? 0.3 : pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
            </Pressable>

            <View style={styles.dots}>
              {media.map((dot, dotIndex) => (
                <View
                  key={dot.id}
                  style={[
                    styles.dot,
                    {
                      backgroundColor: dotIndex === index ? '#FFFFFF' : 'rgba(255,255,255,0.35)',
                      width: dotIndex === index ? 18 : 6,
                    },
                  ]}
                />
              ))}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sonraki medya"
              disabled={index === media.length - 1}
              onPress={() => {
                setLoading(true);
                setIndex((current) => Math.min(media.length - 1, current + 1));
              }}
              style={({ pressed }) => [
                styles.navButton,
                { opacity: index === media.length - 1 ? 0.3 : pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : (
          <View style={[{ height: insets.bottom + 12 }, { backgroundColor: theme.colors.background }]} />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  stage: { flex: 1, justifyContent: 'center' },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { height: 6, borderRadius: 3 },
});
