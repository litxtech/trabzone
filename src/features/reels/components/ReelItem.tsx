import { Ionicons } from '@expo/vector-icons';
import { useEvent } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from '@/utils/router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet, AppImage, AppText, Avatar } from '@/components/ui';
import { useToggleFollow } from '@/features/profile/hooks/use-follow';
import { useBlockUser } from '@/features/profile/hooks/use-profile-mutations';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useReportSheet } from '@/features/safety/components/ReportSheetProvider';
import { reelShareLink, shareSnippet } from '@/features/share/links';
import { didShare, shareContent } from '@/features/share/share-action';
import { perf } from '@/perf';
import { haptics } from '@/utils/haptics';

import {
  useDeleteReel,
  useShareReel,
  useToggleReelLike,
  useToggleReelSave,
} from '../hooks/use-reels';
import { reelUrl, type Reel } from '../services/reels-service';
import { formatCount } from '../utils/format';

type Props = {
  reel: Reel;
  active: boolean;
  muted: boolean;
  height: number;
  /** Cihazin alt guvenli alan boslugu (tam ekran goruntuleyici icin). */
  bottomInset?: number;
  onOpenComments: (reel: Reel) => void;
  onEdit: (reel: Reel) => void;
  onDeleted?: (reelId: string) => void;
};

function RailAction({
  icon,
  activeIcon,
  label,
  active,
  tone = 'light',
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  activeIcon?: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active?: boolean;
  tone?: 'light' | 'like';
  onPress: () => void;
}) {
  const color = tone === 'like' && active ? '#FF4D67' : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active) }}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.railAction, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={active && activeIcon ? activeIcon : icon} size={29} color={color} />
      <AppText variant="caption" color="#FFFFFF" style={styles.railLabel}>
        {label}
      </AppText>
    </Pressable>
  );
}

export const ReelItem = memo(function ReelItem({
  reel,
  active,
  muted,
  height,
  bottomInset = 0,
  onOpenComments,
  onEdit,
  onDeleted,
}: Props) {
  const router = useRouter();
  const { openReport } = useReportSheet();

  const videoUri = reelUrl(reel.video_path);
  const posterUri = reelUrl(reel.cover_path);
  const fullName =
    `${reel.author_first_name ?? ''} ${reel.author_last_name ?? ''}`.trim() || reel.author_username;
  const avatarUri = mediaPublicUrl('avatar', reel.author_avatar_path);

  const player = useVideoPlayer(videoUri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    // Android'de ExoPlayer varsayilan 20sn ileri tampon ayirir; arka arkaya
    // acilan oynaticilarda bu bellek/bant israfidir. Kisa Reels videolari icin
    // 4sn + 16MB yeterli, ilk kare daha hizli gelir.
    if (perf.reelBuffer) {
      instance.bufferOptions = perf.reelBuffer;
    }
  });
  const status = useEvent(player, 'statusChange', { status: player.status }).status;
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  const [menuOpen, setMenuOpen] = useState(false);
  const [following, setFollowing] = useState(reel.following_author);

  const toggleFollow = useToggleFollow();
  const toggleLike = useToggleReelLike();
  const toggleSave = useToggleReelSave();
  const share = useShareReel();
  const remove = useDeleteReel();
  const blockAuthor = useBlockUser();

  const confirmBlockAuthor = () => {
    Alert.alert(
      'Kullanıcıyı engelle',
      `@${reel.author_username} engellenecek. İçeriklerini artık göremez, sana ulaşamaz.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Engelle',
          style: 'destructive',
          onPress: () =>
            blockAuthor.mutate(reel.author_id, {
              onSuccess: () => haptics.success(),
              onError: (error) => Alert.alert('Engellenemedi', error.message),
            }),
        },
      ],
    );
  };

  useEffect(() => {
    // expo-video oynatıcısı zorunlu (imperative) bir yerel nesnedir.
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    if (!active) {
      player.pause();
      return;
    }
    if (status === 'readyToPlay') {
      player.play();
    }
  }, [active, player, status]);

  // Bilesen sokuldugunde (sekme degisimi, geri donus) ses kesin olarak durur;
  // expo-video oynaticisi kendi basina arka planda calmaya devam etmesin.
  useEffect(
    () => () => {
      player.pause();
    },
    [player],
  );

  const openProfile = useCallback(() => {
    router.push(`/profile/${reel.author_username}` as never);
  }, [reel.author_username, router]);

  const onLike = useCallback(() => {
    haptics.tap();
    toggleLike.mutate(reel.id);
  }, [reel.id, toggleLike]);

  const onSave = useCallback(() => {
    haptics.tap();
    toggleSave.mutate(reel.id);
  }, [reel.id, toggleSave]);

  const onShare = useCallback(async () => {
    haptics.tap();
    const link = reelShareLink(reel.id);
    const caption = shareSnippet(reel.caption);
    const outcome = await shareContent({
      title: `${fullName} · Trabzone Reels`,
      message: `${fullName} (@${reel.author_username}) Trabzone Reels'te bir video paylaştı.${
        caption ? `\n\n${caption}` : ''
      }\n\n${link}`,
      url: link,
    });
    // Paylaşım sayacı yalnızca paylaşım/kopyalama tamamlandığında artar.
    if (didShare(outcome)) {
      share.mutate(reel.id);
    }
  }, [fullName, reel.author_username, reel.caption, reel.id, share]);

  const confirmDelete = useCallback(() => {
    Alert.alert('Reels videosunu sil', 'Video kalıcı olarak silinecek. Emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () =>
          remove.mutate(reel.id, {
            onSuccess: () => onDeleted?.(reel.id),
            onError: (error) => Alert.alert('Silinemedi', error.message),
          }),
      },
    ]);
  }, [onDeleted, reel.id, remove]);

  const onToggleFollow = useCallback(() => {
    const next = !following;
    setFollowing(next);
    haptics.selection();
    toggleFollow.mutate(
      { userId: reel.author_id, follow: next },
      {
        onError: () => setFollowing(!next),
      },
    );
  }, [following, reel.author_id, toggleFollow]);

  const retry = useCallback(() => {
    if (!videoUri) {
      return;
    }
    void player.replaceAsync(videoUri).then(() => {
      if (active) {
        player.play();
      }
    });
  }, [active, player, videoUri]);

  const audioLabel = reel.audio_title || `Orijinal ses · @${reel.author_username}`;
  const showPoster = !posterUri || status !== 'readyToPlay';

  return (
    <View style={[styles.root, { height }]}>
      {videoUri ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
          // Drawer/sekme kapsayicisi donusum uyguladigi icin SurfaceView bazi
          // Android cihazlarda siyah kaliyordu: ses vardi, goruntu yoktu.
          surfaceType="textureView"
        />
      ) : null}

      {posterUri && showPoster ? (
        <AppImage
          source={{ uri: posterUri }}
          style={StyleSheet.absoluteFill}
          recycleKey={reel.id}
        />
      ) : !posterUri && showPoster ? (
        <LinearGradient
          colors={['#111A2E', '#0A0F1C', '#050810']}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Videoyu duraklat' : 'Videoyu oynat'}
        onPress={() => {
          haptics.tap();
          if (isPlaying) {
            player.pause();
          } else {
            player.play();
          }
        }}
        style={StyleSheet.absoluteFill}
      />

      <LinearGradient
        pointerEvents="none"
        colors={[
          'rgba(3,6,14,0.55)',
          'rgba(3,6,14,0.05)',
          'rgba(3,6,14,0.10)',
          'rgba(3,6,14,0.92)',
        ]}
        locations={[0, 0.22, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />

      {status === 'loading' || status === 'idle' ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color="rgba(255,255,255,0.9)" />
        </View>
      ) : null}

      {status === 'error' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Videoyu yeniden yükle"
          onPress={retry}
          style={styles.errorBox}
        >
          <Ionicons name="refresh" size={20} color="#FFFFFF" />
          <AppText variant="caption" color="#FFFFFF">
            Video yüklenemedi · Tekrar dene
          </AppText>
        </Pressable>
      ) : null}

      {!isPlaying && status === 'readyToPlay' ? (
        <View style={styles.pausedIcon} pointerEvents="none">
          <Ionicons name="play" size={42} color="rgba(255,255,255,0.92)" />
        </View>
      ) : null}

      <View style={[styles.bottom, { bottom: 22 + bottomInset }]} pointerEvents="box-none">
        <View style={styles.authorRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${fullName} profilini aç`}
            onPress={openProfile}
            style={styles.authorPress}
          >
            <Avatar
              uri={avatarUri}
              name={fullName}
              size={36}
              borderColor="#FFFFFF"
              ring
              recycleKey={reel.author_id}
            />
            <View style={styles.authorText}>
              <View style={styles.nameRow}>
                <AppText variant="bodyStrong" color="#FFFFFF" numberOfLines={1} style={styles.name}>
                  {reel.author_username}
                </AppText>
                {reel.author_is_verified ? (
                  <Ionicons name="checkmark-circle" size={14} color="#7AA2FF" />
                ) : null}
              </View>
              <AppText variant="caption" color="rgba(255,255,255,0.72)" numberOfLines={1}>
                {fullName}
              </AppText>
            </View>
          </Pressable>

          {!reel.is_mine ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={following ? 'Takipten çık' : 'Takip et'}
              onPress={onToggleFollow}
              style={({ pressed }) => [
                styles.follow,
                {
                  borderColor: following ? 'rgba(255,255,255,0.45)' : '#FFFFFF',
                  backgroundColor: following ? 'rgba(255,255,255,0.12)' : '#FFFFFF',
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <AppText
                variant="caption"
                color={following ? '#FFFFFF' : '#0B1020'}
                style={styles.followLabel}
              >
                {following ? 'Takip ediliyor' : 'Takip et'}
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {reel.caption ? (
          <View pointerEvents="none">
            <AppText variant="body" color="#FFFFFF" numberOfLines={3} style={styles.caption}>
              {reel.caption}
            </AppText>
          </View>
        ) : null}

        {/* Metin ve ses satırı tıklamayı yutmaz: videonun üstüne dokununca
            duraklatma çalışmaya devam eder. */}
        <View pointerEvents="none" style={styles.audioRow}>
          <View style={styles.audioIcon}>
            <Ionicons name="musical-notes" size={13} color="#FFFFFF" />
          </View>
          <AppText
            variant="caption"
            color="rgba(255,255,255,0.9)"
            numberOfLines={1}
            style={styles.audio}
          >
            {audioLabel}
          </AppText>
        </View>
      </View>

      <View style={[styles.rail, { bottom: 26 + bottomInset }]} pointerEvents="box-none">
        <RailAction
          icon="heart-outline"
          activeIcon="heart"
          label={formatCount(reel.like_count)}
          active={reel.liked}
          tone="like"
          onPress={onLike}
        />
        <RailAction
          icon="chatbubble-outline"
          label={formatCount(reel.comment_count)}
          onPress={() => onOpenComments(reel)}
        />
        <RailAction
          icon="bookmark-outline"
          activeIcon="bookmark"
          label={formatCount(reel.save_count)}
          active={reel.saved}
          onPress={onSave}
        />
        <RailAction icon="paper-plane-outline" label="Paylaş" onPress={() => void onShare()} />
        <RailAction
          icon="ellipsis-horizontal"
          label="Daha fazla"
          onPress={() => setMenuOpen(true)}
        />
      </View>

      <ActionSheet
        visible={menuOpen}
        title="Reels"
        items={[
          ...(reel.is_mine
            ? [
                { key: 'edit', label: 'Açıklamayı düzenle', icon: 'create-outline' as const },
                {
                  key: 'delete',
                  label: 'Videoyu sil',
                  icon: 'trash-outline' as const,
                  destructive: true,
                },
              ]
            : [
                { key: 'profile', label: 'Profili görüntüle', icon: 'person-outline' as const },
                {
                  key: 'block',
                  label: 'Kullanıcıyı engelle',
                  icon: 'ban-outline' as const,
                  destructive: true,
                },
                {
                  key: 'report',
                  label: 'Videoyu şikâyet et',
                  icon: 'flag-outline' as const,
                  destructive: true,
                },
              ]),
          { key: 'share', label: 'Bağlantıyı paylaş', icon: 'share-social-outline' as const },
        ]}
        onClose={() => setMenuOpen(false)}
        onSelect={(key) => {
          setMenuOpen(false);
          if (key === 'edit') {
            onEdit(reel);
          } else if (key === 'delete') {
            confirmDelete();
          } else if (key === 'profile') {
            openProfile();
          } else if (key === 'block') {
            confirmBlockAuthor();
          } else if (key === 'report') {
            setTimeout(
              () =>
                openReport({
                  targetType: 'reel',
                  targetId: reel.id,
                  targetUserId: reel.author_id,
                  targetLabel: reel.caption || 'Reels videosu',
                }),
              280,
            );
          } else if (key === 'share') {
            void onShare();
          }
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { width: '100%', backgroundColor: '#000000', overflow: 'hidden' },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    position: 'absolute',
    alignSelf: 'center',
    top: '44%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(9,14,28,0.72)',
  },
  pausedIcon: {
    position: 'absolute',
    alignSelf: 'center',
    top: '44%',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(9,14,28,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    position: 'absolute',
    left: 16,
    right: 92,
    bottom: 22,
    gap: 10,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  authorPress: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 },
  authorText: { flexShrink: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1 },
  follow: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.2,
    minHeight: 32,
    justifyContent: 'center',
  },
  followLabel: { fontSize: 12, fontWeight: '700' },
  caption: { lineHeight: 21, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  audioIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audio: { flex: 1 },
  rail: {
    position: 'absolute',
    right: 10,
    bottom: 26,
    alignItems: 'center',
    gap: 17,
  },
  railAction: { alignItems: 'center', gap: 3, minWidth: 52 },
  railLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 4,
  },
});
