import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { AppText, Avatar, Button } from '@/components/ui';
import { useCanMessage, useStartDirectConversation } from '@/features/messaging/hooks/use-chat';
import { PremiumSheet } from '@/features/overlay/PremiumSheet';
import { useToggleFollow } from '@/features/profile/hooks/use-follow';
import { useProfileView } from '@/features/profile/hooks/use-profile-view';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { formatCount } from '@/features/reels/utils/format';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { useSession } from '@/stores/auth-store';

type Props = {
  visible: boolean;
  userId: string;
  username: string | null;
  onClose: () => void;
  onViewProfile: (username: string) => void;
  onOpenChat: (conversationId: string) => void;
};

/**
 * Yorum kartının üzerinde açılan tam genişlik profil önizlemesi.
 * Yorum kartını unmount etmez; tek native Modal içinde katman olarak yaşar.
 */
export function ProfilePreviewSheet({
  userId,
  username,
  onClose,
  onViewProfile,
  onOpenChat,
}: Props) {
  const { theme } = useTheme();
  const session = useSession();
  const me = session?.user?.id ?? null;
  const handle = (username ?? '').trim().toLowerCase();
  const { data: profile, isLoading, isError, refetch } = useProfileView(handle);
  const toggleFollow = useToggleFollow();
  const startChat = useStartDirectConversation();
  const canMessage = useCanMessage(profile && !profile.is_me ? profile.id : null);

  const [followed, setFollowed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const name = useMemo(() => {
    if (!profile) {
      return '';
    }
    return (
      `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || `@${profile.username}`
    );
  }, [profile]);

  const isFollowing = followed ?? profile?.i_follow ?? false;
  const isMine = profile?.is_me ?? (userId === me);
  const followerDelta =
    profile && followed !== null && followed !== profile.i_follow ? (followed ? 1 : -1) : 0;

  const handleFollow = () => {
    if (!profile || toggleFollow.isPending) {
      return;
    }
    const next = !isFollowing;
    setFollowed(next);
    setError(null);
    haptics.selection();
    toggleFollow.mutate(
      { userId: profile.id, follow: next },
      {
        onError: (mutationError) => {
          setFollowed(!next);
          setError(mutationError.message);
        },
      },
    );
  };

  const handleMessage = () => {
    if (!profile || startChat.isPending) {
      return;
    }
    setError(null);
    startChat.mutate(profile.id, {
      onSuccess: ({ id }) => {
        haptics.success();
        onOpenChat(id);
      },
      onError: (mutationError) => setError(mutationError.message),
    });
  };

  const header = (
    <View style={styles.header}>
      <View style={styles.headerSide} />
      <View style={styles.headerCenter}>
        <AppText variant="label" color="textTertiary">
          PROFİL
        </AppText>
      </View>
      <Pressable
        onPress={onClose}
        hitSlop={10}
        style={styles.closeButton}
        accessibilityRole="button"
        accessibilityLabel="Profil önizlemesini kapat"
      >
        <Ionicons name="close" size={19} color={theme.colors.textSecondary} />
      </Pressable>
    </View>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <PremiumSheet
        onClose={onClose}
        header={header}
        collapsedRatio={0.5}
        expandedRatio={0.82}
        surfaceColor={theme.scheme === 'dark' ? 'rgba(20,28,48,0.97)' : 'rgba(255,255,255,0.98)'}
        borderColor={theme.colors.border}
        grabberColor={theme.colors.borderStrong}
        backdropColor="rgba(3,7,14,0.5)"
        headerAccessibilityLabel="Profil kartını kapat"
      >
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : isError || !profile ? (
          <View style={styles.centered}>
            <Ionicons name="person-circle-outline" size={44} color={theme.colors.textTertiary} />
            <AppText variant="body" color="textSecondary" align="center">
              Profil yüklenemedi.
            </AppText>
            <Button label="Tekrar dene" variant="secondary" size="sm" onPress={() => void refetch()} />
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Avatar
              uri={mediaPublicUrl('avatar', profile.avatar_path)}
              name={name}
              size={86}
              ring
              recycleKey={profile.id}
            />

            <View style={styles.identity}>
              <View style={styles.nameRow}>
                <AppText variant="h2" numberOfLines={1} style={styles.name}>
                  {name}
                </AppText>
                {profile.is_verified ? (
                  <Ionicons name="checkmark-circle" size={19} color={theme.colors.primary} />
                ) : null}
              </View>
              <AppText variant="body" color="textSecondary">
                @{profile.username}
              </AppText>
            </View>

            {profile.blocked ? (
              <Notice
                icon="lock-closed-outline"
                text="Bu kullanıcıya erişilemiyor. Engel kaldırılmadan profil bilgileri gösterilmez."
              />
            ) : (
              <>
                {profile.restricted ? (
                  <Notice
                    icon="lock-closed-outline"
                    text="Bu profil gizli. İçerikleri görmek için takip isteği göndermen gerekebilir."
                  />
                ) : profile.bio ? (
                  <AppText variant="body" align="center" style={styles.bio}>
                    {profile.bio}
                  </AppText>
                ) : null}

                <View style={styles.stats}>
                  <Stat label="Gönderi" value={profile.posts_count} />
                  <View style={[styles.statDivider, { backgroundColor: theme.colors.border }]} />
                  <Stat label="Takipçi" value={Math.max(0, profile.followers_count + followerDelta)} />
                  <View style={[styles.statDivider, { backgroundColor: theme.colors.border }]} />
                  <Stat label="Takip" value={profile.following_count} />
                </View>

                {error ? (
                  <AppText variant="caption" color="danger" align="center">
                    {error}
                  </AppText>
                ) : null}

                <View style={styles.actions}>
                  {!isMine ? (
                    <Button
                      label={isFollowing ? 'Takibi Bırak' : 'Takip Et'}
                      variant={isFollowing ? 'secondary' : 'primary'}
                      leftIcon={
                        <Ionicons
                          name={isFollowing ? 'checkmark' : 'person-add-outline'}
                          size={17}
                          color={isFollowing ? theme.colors.primaryDeep : theme.colors.onPrimary}
                        />
                      }
                      loading={toggleFollow.isPending}
                      onPress={handleFollow}
                      style={styles.actionButton}
                    />
                  ) : null}

                  {!isMine && canMessage.data ? (
                    <Button
                      label="Mesaj Gönder"
                      variant="secondary"
                      leftIcon={
                        <Ionicons
                          name="chatbubble-ellipses-outline"
                          size={17}
                          color={theme.colors.primaryDeep}
                        />
                      }
                      loading={startChat.isPending}
                      onPress={handleMessage}
                      style={styles.actionButton}
                    />
                  ) : null}
                </View>

                <Pressable
                  onPress={() => onViewProfile(profile.username)}
                  accessibilityRole="button"
                  accessibilityLabel="Profili görüntüle"
                  style={({ pressed }) => [
                    styles.viewProfile,
                    { opacity: pressed ? 0.65 : 1, borderTopColor: theme.colors.border },
                  ]}
                >
                  <AppText variant="bodyStrong" color="primaryDeep">
                    Profili Gör
                  </AppText>
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.primaryDeep} />
                </Pressable>
              </>
            )}
          </ScrollView>
        )}
      </PremiumSheet>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <AppText variant="bodyStrong" style={styles.statValue}>
        {formatCount(value)}
      </AppText>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

function Notice({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: theme.colors.surfaceMuted }]}>
      <Ionicons name={icon} size={15} color={theme.colors.textSecondary} />
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 6,
  },
  headerSide: { width: 34 },
  headerCenter: { flex: 1, alignItems: 'center' },
  closeButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  content: { alignItems: 'center', paddingHorizontal: 22, paddingTop: 8, paddingBottom: 22, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  identity: { alignItems: 'center', gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' },
  name: { flexShrink: 1 },
  bio: { lineHeight: 21, maxWidth: 320 },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
    marginTop: 2,
  },
  stat: { flex: 1, alignItems: 'center', gap: 1 },
  statValue: { fontSize: 16 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 24 },
  actions: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginTop: 2 },
  actionButton: { flex: 1 },
  viewProfile: {
    alignSelf: 'stretch',
    marginTop: 6,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12 },
  flex: { flex: 1 },
});
