import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from '@/utils/router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, Share, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Card, IconButton, Screen, Skeleton } from '@/components/ui';
import { fetchAccountOverview, providerLabel } from '@/features/account/services/account-service';
import { useDrawer } from '@/features/navigation/drawer-context';
import { ConnectionsSheet } from '@/features/profile/components/ConnectionsSheet';
import { ProfileContentTabs } from '@/features/profile/components/ProfileContentTabs';
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
  const account = useQuery({
    queryKey: ['account-overview'],
    queryFn: async () => {
      const result = await fetchAccountOverview();
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    staleTime: 60_000,
  });

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
        <View style={styles.headerIcons}>
          <IconButton
            name="map-outline"
            accessibilityLabel="Etkileşim haritası"
            variant="surface"
            size={19}
            onPress={() => router.push('/map' as never)}
          />
          <IconButton
            name="settings-outline"
            accessibilityLabel="Ayarlar"
            variant="surface"
            size={19}
            onPress={() => router.push('/settings')}
          />
        </View>
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

            {/* Paylas butonu kapagin uzerinde, kullanici adinin hemen ustunde. */}
            <View style={styles.coverActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Profili paylaş"
                onPress={() => void shareProfile()}
                style={({ pressed }) => [styles.sharePill, { opacity: pressed ? 0.75 : 1 }]}
              >
                <Ionicons name="share-social-outline" size={15} color="#FFFFFF" />
                <AppText variant="caption" color="#FFFFFF">
                  Paylaş
                </AppText>
              </Pressable>
            </View>
          </View>

          <View style={styles.avatarRow}>
            <Avatar uri={avatarUrl} name={fullName} size={92} ring />
            <View style={styles.avatarActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Profili düzenle"
                onPress={() => router.push('/settings/edit-profile')}
                style={({ pressed }) => [styles.editAction, { opacity: pressed ? 0.85 : 1 }]}
              >
                <LinearGradient
                  colors={theme.gradients.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.editGradient}
                >
                  <Ionicons name="create-outline" size={16} color={theme.colors.onPrimary} />
                  <AppText variant="label" color="onPrimary">
                    Düzenle
                  </AppText>
                </LinearGradient>
              </Pressable>
            </View>
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

            {account.data && account.data.providers.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Bağlı hesapları yönet"
                onPress={() => router.push('/settings/account')}
                style={({ pressed }) => [
                  styles.linkedCard,
                  {
                    backgroundColor: theme.colors.surfaceMuted,
                    borderColor: theme.colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={styles.linkedText}>
                  <AppText variant="caption" color="textTertiary">
                    Bağlı hesaplar
                  </AppText>
                  <View style={styles.providerChips}>
                    {account.data.providers.map((provider) => (
                      <ProviderChip key={provider} provider={provider} />
                    ))}
                  </View>
                </View>
                <View style={styles.linkedAction}>
                  <AppText variant="caption" color="primaryDeep">
                    Yönet
                  </AppText>
                  <Ionicons name="chevron-forward" size={14} color={theme.colors.primaryDeep} />
                </View>
              </Pressable>
            ) : null}
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

          <ProfileContentTabs username={profile.username} userId={profile.id} isOwner />
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

function ProviderChip({ provider }: { provider: string }) {
  const { theme } = useTheme();
  const icon: React.ComponentProps<typeof Ionicons>['name'] =
    provider === 'apple'
      ? 'logo-apple'
      : provider === 'google'
        ? 'logo-google'
        : provider === 'phone'
          ? 'call-outline'
          : 'mail-outline';

  return (
    <View style={[styles.providerChip, { backgroundColor: theme.colors.surface }]}>
      <Ionicons name={icon} size={12} color={theme.colors.textSecondary} />
      <AppText variant="caption" color="textSecondary">
        {providerLabel(provider)}
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
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skeleton: { gap: 12 },
  errorCard: { alignItems: 'center', gap: 10 },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  cover: {
    height: 168,
    borderRadius: 26,
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
  coverActions: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sharePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(9,14,28,0.5)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginTop: -44,
    zIndex: 2,
  },
  avatarActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  iconAction: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  editAction: {
    borderRadius: 999,
    overflow: 'hidden',
    shadowColor: '#0B1220',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  editGradient: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
  },
  identity: { paddingTop: 12, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1 },
  bio: { marginTop: 8 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  linkedText: { flex: 1, gap: 5 },
  linkedAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  providerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  providerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    marginTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
