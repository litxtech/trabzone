import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused, useLocalSearchParams } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useRouter } from '@/utils/router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { useReel, registerViewOnce } from '@/features/reels/hooks/use-reels';
import { ReelCommentsSheet } from '@/features/reels/components/ReelCommentsSheet';
import { ReelEditSheet } from '@/features/reels/components/ReelEditSheet';
import { ReelItem } from '@/features/reels/components/ReelItem';
import { useTheme } from '@/theme/ThemeProvider';

export default function ReelViewerScreen() {
  const params = useLocalSearchParams<{ id?: string; comment?: string }>();
  const reelId = typeof params.id === 'string' ? params.id : '';
  const initialCommentId = typeof params.comment === 'string' ? params.comment : undefined;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const { height } = useWindowDimensions();
  const focused = useIsFocused();

  const { data: reel, isLoading, isError, refetch } = useReel(reelId);
  const [muted, setMuted] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(Boolean(initialCommentId));
  const [editing, setEditing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle(scheme === 'dark' ? 'light' : 'dark');
    }, [scheme]),
  );

  useEffect(() => {
    if (reel?.id) {
      void registerViewOnce(reel.id);
    }
  }, [reel?.id]);

  return (
    <View style={styles.root}>
      {reel ? (
        <ReelItem
          reel={reel}
          active={focused}
          muted={muted}
          height={height}
          bottomInset={insets.bottom}
          onOpenComments={() => setCommentsOpen(true)}
          onEdit={() => setEditing(true)}
          onDeleted={() => router.back()}
        />
      ) : (
        <View style={styles.center}>
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="videocam-off-outline" size={30} color="rgba(255,255,255,0.7)" />
              <AppText variant="h3" color="#FFFFFF" align="center">
                Reels yüklenemedi
              </AppText>
              <AppText variant="body" color="rgba(255,255,255,0.65)" align="center">
                {isError ? 'Bağlantını kontrol edip tekrar dene.' : 'Bu video kullanılamıyor.'}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tekrar dene"
                onPress={() => void refetch()}
                style={({ pressed }) => [styles.retry, { opacity: pressed ? 0.75 : 1 }]}
              >
                <AppText variant="label" color="#0B1020">
                  Tekrar dene
                </AppText>
              </Pressable>
            </>
          )}
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Geri"
        hitSlop={10}
        onPress={() => router.back()}
        style={[styles.back, { top: insets.top + 8 }]}
      >
        <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Sesi aç' : 'Sesi kapat'}
        hitSlop={10}
        onPress={() => setMuted((value) => !value)}
        style={[styles.mute, { top: insets.top + 8 }]}
      >
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={19} color="#FFFFFF" />
      </Pressable>

      <ReelCommentsSheet
        visible={commentsOpen}
        reelId={reel?.id ?? ''}
        commentCount={reel?.comment_count ?? 0}
        onClose={() => setCommentsOpen(false)}
      />

      <ReelEditSheet
        key={editing ? reel?.id ?? 'editing' : 'none'}
        visible={editing}
        reel={reel ?? null}
        onClose={() => setEditing(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  retry: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  back: {
    position: 'absolute',
    left: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,12,22,0.42)',
  },
  mute: {
    position: 'absolute',
    right: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,12,22,0.42)',
  },
});
