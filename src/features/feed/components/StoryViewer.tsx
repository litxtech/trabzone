import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Avatar, IconButton } from '@/components/ui';
import { publicMediaUrl, removeMedia } from '@/features/media/media-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr } from '@/utils/date';

import { useDeleteStory, useMarkStoryViewed, useStoryViewers } from '../hooks/use-stories';
import type { StoryGroup } from '../services/stories-service';

const IMAGE_DURATION = 5000;

// Üst çubuk yüksekliği: 6 (üst boşluk) + 9 (ilerleme çubuğu) + 10 (gap) +
// 44 (buton yüksekliği) = 69. 6px'lik hitSlop payıyla birlikte 80'e yuvarlanır.
// Dokunma alanları bu sınırın ALTINDAN başlamalı; aksi halde silme/kapat
// butonlarının üzerine binip dokunuşları yutuyorlar.
const HEADER_OFFSET = 80;

export function StoryViewer({
  group,
  startIndex,
  onClose,
}: {
  group: StoryGroup | null;
  startIndex: number;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(startIndex);
  const [progress, setProgress] = useState(0);
  const [showViewers, setShowViewers] = useState(false);
  // Silinen hikâyeler yerelde de düşülür: sorgu yenilenene kadar izleyici
  // eski kareyi oynatmaya ve ilerleme çubuğunda göstermeye devam ediyordu.
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const markViewed = useMarkStoryViewed();
  const deleteStory = useDeleteStory();

  const items = useMemo(
    () => (group?.items ?? []).filter((item) => !removedIds.has(item.id)),
    [group?.items, removedIds],
  );
  const active = items[index];
  const isVideo = active?.media_type === 'video';
  const mediaUri = active ? publicMediaUrl('stories', active.media_path) : null;
  const avatarUrl = mediaPublicUrl('avatar', group?.avatar_path ?? null);
  const name = group ? `${group.first_name ?? ''} ${group.last_name ?? ''}`.trim() || group.username : '';
  const viewers = useStoryViewers(showViewers && group?.is_me ? (active?.id ?? null) : null);

  const player = useVideoPlayer(isVideo ? mediaUri : null, (instance) => {
    instance.loop = false;
    instance.muted = false;
    instance.timeUpdateEventInterval = 0.1;
  });

  const itemsLength = items.length;

  // Kapanis ve ilerleme karari setState guncelleyicisi icinde verilemez:
  // guncelleyici saf olmali, icine yazilan `onClose()` render sirasinda
  // calisarak "Cannot update a component while rendering" hatasi uretiyordu.
  // Bu yuzden guncel index bir ref ile aynalanir ve karar senkron verilir.
  const indexRef = useRef(index);

  const close = useCallback(() => {
    try {
      player.pause();
    } catch {
      // Oynatıcı zaten kapanmış olabilir.
    }
    onClose();
  }, [onClose, player]);

  const advance = useCallback(
    (direction: 1 | -1) => {
      const next = indexRef.current + direction;
      if (next < 0) {
        setProgress(0);
        return;
      }
      if (next >= itemsLength) {
        close();
        return;
      }
      setProgress(0);
      indexRef.current = next;
      setIndex(next);
    },
    [close, itemsLength],
  );

  // Mark the visible story as viewed once.
  const viewedIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    if (!active || viewedIds.current.has(active.id)) {
      return;
    }
    viewedIds.current.add(active.id);
    markViewed.mutate(active.id);
  }, [active, markViewed]);

  // Image timer.
  useEffect(() => {
    if (!active || active.media_type !== 'image') {
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      const ratio = (Date.now() - started) / IMAGE_DURATION;
      setProgress(Math.min(ratio, 1));
      if (ratio >= 1) {
        clearInterval(timer);
        advance(1);
      }
    }, 80);
    return () => clearInterval(timer);
  }, [active, advance]);

  // Video playback. Kaynak değişimi replaceAsync ile geldiği için hazır olma
  // durumunu olay üzerinden bekleriz; aksi halde ilk kare oynamayabilir.
  useEffect(() => {
    if (!active || active.media_type !== 'video') {
      return;
    }

    const play = () => {
      try {
        if (!player.playing) {
          player.play();
        }
      } catch {
        // Oynatıcı henüz hazır değilse statusChange olayı tekrar dener.
      }
    };

    play();
    const statusSub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') {
        play();
      }
    });
    const sourceSub = player.addListener('sourceChange', play);

    return () => {
      statusSub.remove();
      sourceSub.remove();
    };
  }, [active, player]);

  useEffect(() => {
    if (!isVideo) {
      return;
    }
    const timeSub = player.addListener('timeUpdate', ({ currentTime }) => {
      const duration = player.duration || 1;
      setProgress(Math.min(currentTime / duration, 1));
    });
    const endSub = player.addListener('playToEnd', () => advance(1));
    return () => {
      timeSub.remove();
      endSub.remove();
    };
  }, [advance, isVideo, player]);

  const confirmDelete = useCallback(() => {
    if (!active) {
      return;
    }
    const deleted = active;
    Alert.alert('Hikâyeyi sil', 'Bu hikâye kalıcı olarak silinecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () =>
          deleteStory.mutate(deleted.id, {
            onSuccess: () => {
              const remaining = items.filter((item) => item.id !== deleted.id);
              setRemovedIds((current) => {
                const next = new Set(current);
                next.add(deleted.id);
                return next;
              });
              // Kayıt silinse bile dosya depolamada kalırsa hikâye
              // "platformdan kalkmamış" gibi görünür; en iyi çabayla temizle.
              void removeMedia('stories', [deleted.media_path]).catch(() => {
                // Depolama temizliği başarısız olsa da hikâye kaydı silindi.
              });
              if (remaining.length === 0) {
                close();
                return;
              }
              const nextIndex = Math.min(index, remaining.length - 1);
              setProgress(0);
              indexRef.current = nextIndex;
              setIndex(nextIndex);
            },
            onError: (error) => Alert.alert('Silinemedi', error.message),
          }),
      },
    ]);
  }, [active, close, deleteStory, index, items]);

  const segments = useMemo(() => items.map((item) => item.id), [items]);

  if (!group || !active) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      <View style={styles.root}>
        {active.media_type === 'video' && mediaUri ? (
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} surfaceType="textureView" />
        ) : (
          <Image
            source={mediaUri ? { uri: mediaUri } : undefined}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            transition={120}
            cachePolicy="memory-disk"
          />
        )}
        <View style={styles.scrim} pointerEvents="none" />

        {/* Dokunma alanları header'dan ÖNCE çizilir ve header'ın altından
            başlar. Önceden sonra çiziliyorlardı: absolute konumlu bu iki alan
            üst çubuğun üzerine binince trash (sil) ve close (kapat)
            butonlarına yapılan dokunuşlar bu alanlara gidiyor, buton hiç
            tepki vermiyor gibi görünüyordu. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Önceki hikâye"
          style={[styles.prevZone, { top: insets.top + HEADER_OFFSET }]}
          onPress={() => advance(-1)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sonraki hikâye"
          style={[styles.nextZone, { top: insets.top + HEADER_OFFSET }]}
          onPress={() => advance(1)}
        />

        <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 6 }]}>
          <View style={styles.progress}>
            {segments.map((id, segmentIndex) => (
              <View key={id} style={styles.segmentTrack}>
                <View
                  style={[
                    styles.segmentFill,
                    {
                      backgroundColor: '#FFFFFF',
                      width:
                        segmentIndex < index
                          ? '100%'
                          : segmentIndex === index
                            ? `${Math.round(progress * 100)}%`
                            : '0%',
                    },
                  ]}
                />
              </View>
            ))}
          </View>

          <View style={styles.header}>
            <Avatar uri={avatarUrl} name={name} size={36} />
            <View style={styles.headerText}>
              <AppText variant="label" color="#FFFFFF" numberOfLines={1}>
                {name}
                {group.is_verified ? ' ✓' : ''}
              </AppText>
              <AppText variant="caption" color="rgba(255,255,255,0.7)">
                {formatRelativeTr(active.created_at)}
              </AppText>
            </View>
            {group.is_me ? (
              <IconButton
                name="trash-outline"
                accessibilityLabel="Hikâyeyi sil"
                variant="glass"
                size={18}
                color="#FFFFFF"
                onPress={confirmDelete}
              />
            ) : null}
            <IconButton
              name="close"
              accessibilityLabel="Kapat"
              variant="glass"
              size={18}
              color="#FFFFFF"
              onPress={close}
            />
          </View>
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
          {active.caption ? (
            <View style={styles.captionWrap}>
              <AppText variant="body" color="#FFFFFF" align="center">
                {active.caption}
              </AppText>
            </View>
          ) : null}

          {group.is_me ? (
            <View style={styles.ownerBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Hikâye izleyenleri"
                onPress={() => setShowViewers((value) => !value)}
                style={styles.viewerButton}
              >
                <Ionicons name="eye-outline" size={17} color="#FFFFFF" />
                <AppText variant="label" color="#FFFFFF">
                  {active.view_count ?? 0} görüntüleme
                </AppText>
              </Pressable>

              {showViewers ? (
                <View style={[styles.viewers, { backgroundColor: theme.colors.surface }]}>
                  {viewers.isLoading ? (
                    <ActivityIndicator color={theme.colors.primary} />
                  ) : viewers.data && viewers.data.length > 0 ? (
                    viewers.data.slice(0, 8).map((viewer) => (
                      <View key={viewer.user_id} style={styles.viewerRow}>
                        <Avatar
                          uri={mediaPublicUrl('avatar', viewer.avatar_path)}
                          name={viewer.username}
                          size={26}
                        />
                        <AppText variant="caption" numberOfLines={1} style={styles.viewerName}>
                          {viewer.username}
                        </AppText>
                        <AppText variant="caption" color="textTertiary">
                          {formatRelativeTr(viewer.viewed_at)}
                        </AppText>
                      </View>
                    ))
                  ) : (
                    <AppText variant="caption" color="textSecondary">
                      Henüz görüntüleme yok.
                    </AppText>
                  )}
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.hintRow}>
              <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
              <AppText variant="caption" color="rgba(255,255,255,0.7)">
                İlerlemek için dokun
              </AppText>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05080F' },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(5,8,15,0.15)',
  },
  // `zIndex`: absolute konumlu dokunma alanları web'de varsayılan olarak
  // normal akıştaki bu çubuğun üzerine boyanıyor; bu yüzden üst çubuk açıkça
  // bir kat yukarı alınır (aksi halde sil/kapat butonları tıklanamıyordu).
  top: { paddingHorizontal: 12, gap: 10, zIndex: 2 },
  progress: { flexDirection: 'row', gap: 4, paddingTop: 6 },
  segmentTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  segmentFill: { height: '100%', borderRadius: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  headerText: { flex: 1, gap: 1 },
  prevZone: { position: 'absolute', left: 0, bottom: 110, width: '32%' },
  nextZone: { position: 'absolute', right: 0, bottom: 110, width: '68%' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, gap: 12 },
  captionWrap: {
    alignSelf: 'center',
    backgroundColor: 'rgba(9,14,28,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    maxWidth: '92%',
  },
  ownerBar: { gap: 10 },
  viewerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(9,14,28,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  viewers: { borderRadius: 16, padding: 12, gap: 9 },
  viewerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewerName: { flex: 1 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center' },
});
