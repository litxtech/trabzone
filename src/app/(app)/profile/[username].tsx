import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import {
  ActionSheet,
  AppText,
  Avatar,
  Button,
  Card,
  Screen,
  ScreenHeader,
  Skeleton,
} from '@/components/ui';
import { useCanMessage, useStartDirectConversation } from '@/features/messaging/hooks/use-chat';
import { profileShareLink } from '@/features/share/links';
import { shareContent } from '@/features/share/share-action';
import { ConnectionsSheet } from '@/features/profile/components/ConnectionsSheet';
import { ProfileContentTabs } from '@/features/profile/components/ProfileContentTabs';
import { useToggleFollow } from '@/features/profile/hooks/use-follow';
import {
  useCancelFriendRequest,
  useRespondFriendRequest,
  useSendFriendRequest,
} from '@/features/profile/hooks/use-friend-requests';
import { useProfileView } from '@/features/profile/hooks/use-profile-view';
import { useBlockUser, useUnblockUser } from '@/features/profile/hooks/use-profile-mutations';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import type { ConnectionKind } from '@/features/profile/services/social-service';
import { useReportSheet } from '@/features/safety/components/ReportSheetProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

export default function PublicProfileScreen() {
  const { username } = useLocalSearchParams<{ username?: string }>();
  const handle = typeof username === 'string' ? username : '';
  const { theme } = useTheme();
  const router = useRouter();
  const { openReport } = useReportSheet();

  const { data: profile, isLoading, isError, refetch } = useProfileView(handle);
  const toggleFollow = useToggleFollow();
  const sendRequest = useSendFriendRequest();
  const respondRequest = useRespondFriendRequest();
  const cancelRequest = useCancelFriendRequest();
  const blockUser = useBlockUser();
  const unblockUser = useUnblockUser();
  const startChat = useStartDirectConversation();
  const canMessage = useCanMessage(
    profile && !profile.is_me && !profile.blocked ? profile.id : null,
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [connections, setConnections] = useState<ConnectionKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fullName = profile
    ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || `@${profile.username}`
    : '';

  const shareProfile = async () => {
    setMenuOpen(false);
    if (!profile) {
      return;
    }
    const link = profileShareLink(profile.username);
    await shareContent({
      title: fullName,
      message: `${fullName} (@${profile.username}) Trabzone'da. Profilini incele!\n${link}`,
      url: link,
    });
  };

  const reportProfile = () => {
    setMenuOpen(false);
    if (!profile) {
      return;
    }
    // Alt sayfa kapanmadan ikinci bir modal acmak iOS'ta cakismaya yol acar.
    setTimeout(() => {
      openReport({
        targetType: 'user',
        targetId: profile.id,
        targetUserId: profile.id,
        targetLabel: fullName,
        snapshot: { username: profile.username },
      });
    }, 320);
  };

  const confirmBlock = () => {
    setMenuOpen(false);
    if (!profile) {
      return;
    }
    blockUser.mutate(profile.id, {
      onSuccess: () => haptics.success(),
      onError: (error) => setActionError(error.message),
    });
  };

  const toggleFollowAction = () => {
    if (!profile) {
      return;
    }
    setActionError(null);
    toggleFollow.mutate(
      { userId: profile.id, follow: !profile.i_follow },
      {
        onSuccess: () => haptics.selection(),
        onError: (error) => setActionError(error.message),
      },
    );
  };

  const messageProfile = () => {
    if (!profile) {
      return;
    }
    setActionError(null);
    startChat.mutate(profile.id, {
      onSuccess: ({ id }) => {
        haptics.success();
        router.push(`/chat/${id}` as never);
      },
      onError: (error) => setActionError(error.message),
    });
  };

  const busy =
    toggleFollow.isPending ||
    startChat.isPending ||
    sendRequest.isPending ||
    respondRequest.isPending ||
    cancelRequest.isPending ||
    blockUser.isPending ||
    unblockUser.isPending;

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <ScreenHeader
        title={profile ? `@${profile.username}` : 'Profil'}
        onBack={() => router.back()}
        right={
          profile && !profile.blocked ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Profil seçenekleri"
              hitSlop={8}
              onPress={() => setMenuOpen(true)}
              style={[
                styles.menuButton,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.text} />
            </Pressable>
          ) : (
            <View style={styles.menuSpacer} />
          )
        }
      />

      {isLoading ? (
        <View style={styles.skeleton}>
          <Skeleton height={140} radius={22} />
          <Skeleton height={80} radius={18} />
          <Skeleton height={140} radius={18} />
        </View>
      ) : isError ? (
        <Card style={styles.stateCard}>
          <Ionicons name="cloud-offline-outline" size={28} color={theme.colors.textSecondary} />
          <AppText variant="bodyStrong">Profil yüklenemedi</AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Bağlantını kontrol edip tekrar dene.
          </AppText>
          <Button label="Tekrar dene" variant="secondary" onPress={() => void refetch()} />
        </Card>
      ) : !profile ? (
        <Card style={styles.stateCard}>
          <Ionicons name="person-outline" size={28} color={theme.colors.textSecondary} />
          <AppText variant="bodyStrong">Kullanıcı bulunamadı</AppText>
          <AppText variant="body" color="textSecondary" align="center">
            @{handle} adresine ait bir Trabzone profili yok.
          </AppText>
        </Card>
      ) : profile.blocked ? (
        <Card style={styles.stateCard}>
          <View style={[styles.stateIcon, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="ban" size={26} color={theme.colors.danger} />
          </View>
          <AppText variant="bodyStrong">Bu profile erişilemiyor</AppText>
          <AppText variant="body" color="textSecondary" align="center">
            {profile.blocked_by_me
              ? 'Bu kişiyi engelledin. Engeli kaldırarak profilini tekrar görebilirsin.'
              : 'Bu kişiyle aranızda bir engel var.'}
          </AppText>
          {profile.blocked_by_me ? (
            <Button
              label="Engeli kaldır"
              variant="secondary"
              loading={unblockUser.isPending}
              onPress={() =>
                unblockUser.mutate(profile.id, {
                  onSuccess: () => haptics.success(),
                  onError: (error) => setActionError(error.message),
                })
              }
            />
          ) : (
            <Button label="Geri dön" variant="secondary" onPress={() => router.back()} />
          )}
        </Card>
      ) : (
        <>
          <View style={styles.cover}>
            {profile.cover_path ? (
              <Image
                source={{ uri: mediaPublicUrl('cover', profile.cover_path) ?? undefined }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
                cachePolicy="memory-disk"
              />
            ) : (
              <LinearGradient
                colors={theme.gradients.aurora}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            )}
          </View>

          <View style={styles.avatarRow}>
            <Avatar
              uri={mediaPublicUrl('avatar', profile.avatar_path)}
              name={fullName}
              size={92}
              ring
            />
            {profile.follows_me ? (
              <View
                style={[
                  styles.followsMeBadge,
                  { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.pill },
                ]}
              >
                <Ionicons name="person-add-outline" size={13} color={theme.colors.textSecondary} />
                <AppText variant="caption" color="textSecondary">
                  Seni takip ediyor
                </AppText>
              </View>
            ) : null}
          </View>

          <View style={styles.identity}>
            <View style={styles.nameRow}>
              <AppText variant="h2" numberOfLines={1} style={styles.name}>
                {fullName}
              </AppText>
              {profile.is_verified ? (
                <Ionicons name="checkmark-circle" size={19} color={theme.colors.primary} />
              ) : null}
            </View>
            <AppText variant="body" color="textSecondary">
              @{profile.username}
            </AppText>

            {profile.restricted ? (
              <View
                style={[
                  styles.restricted,
                  { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.sm },
                ]}
              >
                <Ionicons name="lock-closed-outline" size={15} color={theme.colors.textSecondary} />
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  {profile.visibility === 'private'
                    ? 'Bu hesap gizli. Detayları görmek için arkadaş olman gerekiyor.'
                    : 'Bu hesap yalnızca takipçilerine açık. Takip ederek içerikleri görebilirsin.'}
                </AppText>
              </View>
            ) : profile.bio ? (
              <AppText variant="body" style={styles.bio}>
                {profile.bio}
              </AppText>
            ) : null}

            <View style={styles.metaRow}>
              {profile.city ? <Meta icon="location-outline" label={profile.city} /> : null}
              <Meta icon="calendar-outline" label={formatJoined(profile.created_at)} />
            </View>

            {profile.website ? (
              <View style={styles.websiteRow}>
                <Ionicons name="link-outline" size={14} color={theme.colors.primaryDeep} />
                <AppText variant="caption" color="primaryDeep" numberOfLines={1}>
                  {profile.website}
                </AppText>
              </View>
            ) : null}

            {profile.is_me ? (
              <Button
                label="Profili düzenle"
                variant="secondary"
                leftIcon={
                  <Ionicons name="create-outline" size={17} color={theme.colors.primaryDeep} />
                }
                onPress={() => router.push('/settings/edit-profile')}
                style={styles.selfButton}
              />
            ) : (
              <>
                <View style={styles.actions}>
                  <Button
                    label={profile.i_follow ? 'Takibi bırak' : 'Takip et'}
                    variant={profile.i_follow ? 'outline' : 'primary'}
                    onPress={toggleFollowAction}
                    loading={toggleFollow.isPending}
                    disabled={busy && !toggleFollow.isPending}
                    leftIcon={
                      profile.i_follow ? undefined : (
                        <Ionicons name="person-add" size={16} color="#FFFFFF" />
                      )
                    }
                    style={styles.actionButton}
                  />

                  {profile.is_friend ? (
                    <View
                      style={[
                        styles.friendBadge,
                        {
                          backgroundColor: theme.colors.successSoft,
                          borderColor: theme.colors.success,
                        },
                      ]}
                    >
                      <Ionicons name="people" size={16} color={theme.colors.success} />
                      <AppText variant="label" color="success">
                        Arkadaşsın
                      </AppText>
                    </View>
                  ) : profile.friend_request_out ? (
                    <Button
                      label="İstek gönderildi"
                      variant="outline"
                      loading={cancelRequest.isPending}
                      onPress={() =>
                        cancelRequest.mutate(profile.friend_request_out as string, {
                          onSuccess: () => haptics.selection(),
                          onError: (error) => setActionError(error.message),
                        })
                      }
                      style={styles.actionButton}
                    />
                  ) : profile.friend_request_in ? (
                    <Button
                      label="İsteği kabul et"
                      variant="secondary"
                      loading={respondRequest.isPending}
                      onPress={() =>
                        respondRequest.mutate(
                          { requestId: profile.friend_request_in as string, action: 'accepted' },
                          {
                            onSuccess: () => haptics.success(),
                            onError: (error) => setActionError(error.message),
                          },
                        )
                      }
                      style={styles.actionButton}
                    />
                  ) : (
                    <Button
                      label="Arkadaş ekle"
                      variant="secondary"
                      loading={sendRequest.isPending}
                      disabled={!profile.accepts_friend_requests}
                      onPress={() =>
                        sendRequest.mutate(
                          { userId: profile.id },
                          {
                            onSuccess: () => haptics.success(),
                            onError: (error) => setActionError(error.message),
                          },
                        )
                      }
                      style={styles.actionButton}
                    />
                  )}
                </View>

                <Button
                  label="Mesaj gönder"
                  variant="outline"
                  onPress={messageProfile}
                  loading={startChat.isPending}
                  disabled={canMessage.data === false || (busy && !startChat.isPending)}
                  leftIcon={
                    <Ionicons
                      name="chatbubble-outline"
                      size={17}
                      color={
                        canMessage.data === false ? theme.colors.textTertiary : theme.colors.text
                      }
                    />
                  }
                  style={styles.messageButton}
                />

                {canMessage.data === false ? (
                  <AppText variant="caption" color="textTertiary" style={styles.requestNote}>
                    Bu kullanıcı gizlilik ayarları nedeniyle doğrudan mesaj kabul etmiyor.
                  </AppText>
                ) : null}

                {!profile.accepts_friend_requests && !profile.is_friend ? (
                  <AppText variant="caption" color="textTertiary" style={styles.requestNote}>
                    Bu kullanıcı arkadaşlık isteklerini kapatmış.
                  </AppText>
                ) : null}

                {profile.friend_request_in ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Arkadaşlık isteğini reddet"
                    onPress={() =>
                      respondRequest.mutate(
                        { requestId: profile.friend_request_in as string, action: 'rejected' },
                        {
                          onSuccess: () => haptics.selection(),
                          onError: (error) => setActionError(error.message),
                        },
                      )
                    }
                    style={styles.rejectLink}
                  >
                    <AppText variant="caption" color="textTertiary">
                      İsteği reddet
                    </AppText>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>

          <View style={[styles.statsRow, { borderColor: theme.colors.divider }]}>
            <Stat value={profile.posts_count} label="Gönderi" />
            <View style={[styles.statDivider, { backgroundColor: theme.colors.divider }]} />
            <Stat
              value={profile.followers_count}
              label="Takipçi"
              onPress={() => setConnections('followers')}
            />
            <View style={[styles.statDivider, { backgroundColor: theme.colors.divider }]} />
            <Stat
              value={profile.following_count}
              label="Takip"
              onPress={() => setConnections('following')}
            />
          </View>

          {actionError ? (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.flex}>
                {actionError}
              </AppText>
            </View>
          ) : null}

          {profile.restricted ? (
            <Card tone="muted" elevated={false} style={styles.emptyCard}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="lock-closed-outline" size={24} color={theme.colors.primaryDeep} />
              </View>
              <AppText variant="bodyStrong">Gönderiler gizli</AppText>
              <AppText variant="body" color="textSecondary" align="center">
                Bu hesabın paylaşımlarını görmek için erişim gerekiyor.
              </AppText>
            </Card>
          ) : (
            <ProfileContentTabs
              username={profile.username}
              userId={profile.id}
              isOwner={Boolean(profile.is_me)}
            />
          )}

          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator size="small" color={theme.colors.textTertiary} />
            </View>
          ) : null}
        </>
      )}

      <ActionSheet
        visible={menuOpen}
        title={profile ? `@${profile.username}` : undefined}
        items={[
          { key: 'share', label: 'Profili paylaş', icon: 'share-social-outline' },
          { key: 'report', label: 'Profili bildir', icon: 'flag-outline', destructive: true },
          { key: 'block', label: 'Engelle', icon: 'ban-outline', destructive: true },
        ]}
        onClose={() => setMenuOpen(false)}
        onSelect={(key) => {
          if (key === 'share') {
            void shareProfile();
          } else if (key === 'report') {
            reportProfile();
          } else if (key === 'block') {
            confirmBlock();
          }
        }}
      />

      <ConnectionsSheet
        visible={connections !== null}
        userId={profile?.id ?? null}
        kind={connections ?? 'followers'}
        onClose={() => setConnections(null)}
      />
    </Screen>
  );
}

function Stat({ value, label, onPress }: { value: number; label: string; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${label}: ${value}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.stat, { opacity: pressed && onPress ? 0.6 : 1 }]}
    >
      <AppText variant="h3">{value.toLocaleString('tr-TR')}</AppText>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </Pressable>
  );
}

function Meta({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={14} color={theme.colors.textTertiary} />
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

function formatJoined(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Trabzone üyesi';
  }
  return `${date.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })} tarihinde katıldı`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  menuSpacer: { width: 40, height: 40 },
  skeleton: { gap: 12 },
  stateCard: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  stateIcon: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cover: { height: 152, borderRadius: 26, overflow: 'hidden' },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 18,
    marginTop: -50,
    zIndex: 2,
  },
  followsMeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
  },
  identity: { paddingTop: 10, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1 },
  bio: { marginTop: 8 },
  restricted: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    padding: 10,
    marginTop: 10,
  },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  websiteRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionButton: { flex: 1 },
  messageButton: { marginTop: 10 },
  friendBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 50,
  },
  selfButton: { marginTop: 16 },
  requestNote: { marginTop: 6 },
  rejectLink: { alignSelf: 'center', paddingVertical: 8 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    marginTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 30 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 14,
  },
  sectionHead: { marginTop: 22, marginBottom: 10 },
  emptyCard: { alignItems: 'center', gap: 8, paddingVertical: 26, borderWidth: 0 },
  emptyIcon: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  busy: { alignItems: 'center', paddingVertical: 12 },
});
