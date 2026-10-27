import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, Share, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Card, IconButton, Screen, Skeleton } from '@/components/ui';
import { useDrawer } from '@/features/navigation/drawer-context';
import { ConnectionsSheet } from '@/features/profile/components/ConnectionsSheet';
import { useIncomingFriendRequestCount } from '@/features/profile/hooks/use-friend-requests';
import { useMyProfile, useMyRoles } from '@/features/profile/hooks/use-my-profile';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import type { ConnectionKind } from '@/features/profile/services/social-service';
import { useTheme } from '@/theme/ThemeProvider';

const STAFF_ROLES = ['admin', 'super_admin', 'moderator', 'support_agent'];

export default function ProfileScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { open: openDrawer } = useDrawer();

  const { data: profile, isLoading, isError, refetch } = useMyProfile();
  const { data: roles } = useMyRoles();
  const pendingRequests = useIncomingFriendRequestCount();
  const [connections, setConnections] = useState<ConnectionKind | null>(null);

  const isStaff = roles?.some((role) => STAFF_ROLES.includes(role)) ?? false;
  const fullName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : '';
  const avatarUrl = mediaPublicUrl('avatar', profile?.avatar_path);
  const coverUrl = mediaPublicUrl('cover', profile?.cover_path);

  const shareProfile = useCallback(async () => {
    if (!profile) {
      return;
    }
    try {
      await Share.share({
        message: `${fullName} (@${profile.username}) Trabzone'da. Sen de katıl!`,
      });
    } catch {
      // Paylasim iptal edildi.
    }
  }, [fullName, profile]);

  return (
    <Screen
      edges={['top', 'left', 'right']}
      scroll
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => void refetch()}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <View style={styles.header}>
        <IconButton
          name="menu"
          accessibilityLabel="Profil menüsünü aç"
          variant="surface"
          size={20}
          onPress={() => openDrawer('profile')}
        />
        <AppText variant="h3">Profilim</AppText>
        <IconButton
          name="settings-outline"
          accessibilityLabel="Ayarlar"
          variant="surface"
          size={19}
          onPress={() => router.push('/settings')}
        />
      </View>

      {isLoading ? (
        <View style={styles.skeleton}>
          <Skeleton height={168} radius={24} />
          <Skeleton height={92} radius={18} />
        </View>
      ) : isError || !profile ? (
        <Card style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={26} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            Profil yüklenemedi.
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tekrar dene"
            onPress={() => void refetch()}
            style={({ pressed }) => [
              styles.retry,
              { backgroundColor: theme.colors.primarySoft, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <AppText variant="label" color="primaryDeep">
              Tekrar dene
            </AppText>
          </Pressable>
        </Card>
      ) : (
        <>
          <View style={styles.cover}>
            {coverUrl ? (
              <Image
                source={{ uri: coverUrl }}
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
            <View style={styles.coverOverlay} />
          </View>

          <View style={styles.avatarRow}>
            <Avatar uri={avatarUrl} name={fullName} size={84} ring />
          </View>

          <View style={styles.identity}>
            <View style={styles.nameRow}>
              <AppText variant="h2" numberOfLines={1} style={styles.name}>
                {fullName}
              </AppText>
              {profile.is_verified ? (
                <Ionicons name="checkmark-circle" size={18} color={theme.colors.primary} />
              ) : null}
            </View>
            <AppText variant="body" color="textSecondary">
              @{profile.username}
            </AppText>

            {profile.bio ? (
              <AppText variant="body" style={styles.bio}>
                {profile.bio}
              </AppText>
            ) : (
              <AppText variant="body" color="textTertiary" style={styles.bio}>
                Henüz bir biyografi eklemedin.
              </AppText>
            )}

            <View style={styles.metaRow}>
              {profile.city ? (
                <Meta icon="location-outline" label={profile.city} />
              ) : null}
              <Meta icon="calendar-outline" label={formatJoined(profile.created_at)} />
              {isStaff ? <Meta icon="shield-checkmark-outline" label="Yetkili" /> : null}
            </View>

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Profili paylaş"
                onPress={() => void shareProfile()}
                style={({ pressed }) => [
                  styles.actionButton,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.border,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Ionicons name="share-social-outline" size={17} color={theme.colors.text} />
                <AppText variant="label">Paylaş</AppText>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Profili düzenle"
                onPress={() => router.push('/settings/edit-profile')}
                style={({ pressed }) => [
                  styles.actionButton,
                  {
                    backgroundColor: theme.colors.primary,
                    borderColor: theme.colors.primary,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons name="create-outline" size={17} color={theme.colors.onPrimary} />
                <AppText variant="label" color="onPrimary">
                  Düzenle
                </AppText>
              </Pressable>
            </View>
          </View>

          {pendingRequests > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${pendingRequests} bekleyen arkadaşlık isteği`}
              onPress={() => router.push('/settings/friends')}
              style={({ pressed }) => [
                styles.requestBanner,
                {
                  backgroundColor: theme.colors.primarySoft,
                  borderColor: theme.colors.primary,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Ionicons name="person-add-outline" size={17} color={theme.colors.primaryDeep} />
              <AppText variant="label" color="primaryDeep" style={styles.requestText}>
                {pendingRequests} bekleyen arkadaşlık isteği
              </AppText>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.primaryDeep} />
            </Pressable>
          ) : null}

          <Card padding={0} style={styles.statsCard}>
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
          </Card>

          <View style={styles.sectionHead}>
            <AppText variant="h3">Gönderiler</AppText>
          </View>

          <Card tone="muted" elevated={false} style={styles.emptyCard}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="camera-outline" size={24} color={theme.colors.primaryDeep} />
            </View>
            <AppText variant="bodyStrong">Henüz gönderin yok</AppText>
            <AppText variant="body" color="textSecondary" align="center">
              Paylaşımların burada listelenecek. Gönderi paylaşımı henüz yayında değil.
            </AppText>
          </Card>
        </>
      )}
      <ConnectionsSheet
        visible={connections !== null}
        userId={profile?.id ?? null}
        kind={connections ?? 'followers'}
        onClose={() => setConnections(null)}
      />
    </Screen>
  );
}

function Stat({
  value,
  label,
  onPress,
}: {
  value: number;
  label: string;
  onPress?: () => void;
}) {
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 14,
  },
  skeleton: { gap: 12 },
  errorCard: { alignItems: 'center', gap: 10 },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  cover: {
    height: 132,
    borderRadius: 24,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  coverOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(11,18,32,0.12)',
  },
  avatarRow: { paddingHorizontal: 18, marginTop: -45, zIndex: 2 },
  identity: { paddingTop: 10, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1 },
  bio: { marginTop: 8 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 46,
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 16,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 30 },
  requestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
  },
  requestText: { flex: 1 },
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
});
