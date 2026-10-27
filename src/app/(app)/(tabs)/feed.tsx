import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Card, IconButton, Logo, Screen, Skeleton, Wordmark } from '@/components/ui';
import { useDrawer } from '@/features/navigation/drawer-context';
import { useFollowingIds, useSuggestedProfiles, useToggleFollow } from '@/features/profile/hooks/use-follow';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import type { DirectoryProfile } from '@/features/profile/services/social-service';
import { useTheme } from '@/theme/ThemeProvider';

export default function FeedScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { open: openDrawer } = useDrawer();

  const { data: profile, refetch: refetchProfile } = useMyProfile();
  const {
    data: members,
    isLoading: membersLoading,
    isError: membersError,
    refetch: refetchMembers,
  } = useSuggestedProfiles(6);
  const { data: followingIds } = useFollowingIds();
  const toggleFollow = useToggleFollow();

  const following = new Set(followingIds ?? []);
  const firstName = profile?.first_name ?? 'tekrar hoş geldin';

  const onRefresh = useCallback(() => {
    void refetchProfile();
    void refetchMembers();
  }, [refetchMembers, refetchProfile]);

  return (
    <Screen
      edges={['top', 'left', 'right']}
      scroll
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <IconButton
            name="menu"
            accessibilityLabel="Menüyü aç"
            variant="surface"
            size={20}
            onPress={() => openDrawer('main')}
          />
          <Logo size={26} />
          <Wordmark size={17} />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profilime git"
          onPress={() => router.navigate('/profile')}
          hitSlop={6}
        >
          <Avatar
            uri={mediaPublicUrl('avatar', profile?.avatar_path)}
            name={profile ? `${profile.first_name} ${profile.last_name}` : undefined}
            size={38}
          />
        </Pressable>
      </View>

      <View style={styles.hero}>
        <LinearGradient
          colors={theme.gradients.aurora}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.heroContent}>
          <AppText variant="overline" color="rgba(255,255,255,0.78)">
            TRABZONE
          </AppText>
          <AppText variant="h1" color="#FFFFFF">
            Merhaba, {firstName}
          </AppText>
          <AppText variant="body" color="rgba(255,255,255,0.86)">
            Toplulukta yeni insanlar keşfet, bağlantı kur.
          </AppText>

          <View style={styles.heroStats}>
            <HeroStat label="Gönderi" value={profile?.posts_count ?? 0} />
            <View style={styles.heroDivider} />
            <HeroStat label="Takipçi" value={profile?.followers_count ?? 0} />
            <View style={styles.heroDivider} />
            <HeroStat label="Takip" value={profile?.following_count ?? 0} />
          </View>
        </View>
      </View>

      <View style={styles.sectionHead}>
        <AppText variant="h3">Topluluk</AppText>
        <AppText variant="caption" color="textSecondary">
          Yeni katılanlar
        </AppText>
      </View>

      {membersLoading ? (
        <View style={styles.skeleton}>
          <Skeleton height={72} radius={18} />
          <Skeleton height={72} radius={18} />
          <Skeleton height={72} radius={18} />
        </View>
      ) : membersError ? (
        <Card style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={26} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            Topluluk listesi yüklenemedi.
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tekrar dene"
            onPress={() => void refetchMembers()}
            style={({ pressed }) => [
              styles.retry,
              {
                backgroundColor: theme.colors.primarySoft,
                borderRadius: theme.radius.pill,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <AppText variant="label" color="primaryDeep">
              Tekrar dene
            </AppText>
          </Pressable>
        </Card>
      ) : members && members.length > 0 ? (
        <Card padding={0} style={styles.membersCard}>
          {members.map((member, index) => (
            <MemberRow
              key={member.id}
              member={member}
              isFollowing={following.has(member.id)}
              isPending={toggleFollow.isPending && toggleFollow.variables?.userId === member.id}
              last={index === members.length - 1}
              onOpen={() => router.push(`/profile/${member.username}` as never)}
              onToggle={() =>
                toggleFollow.mutate({ userId: member.id, follow: !following.has(member.id) })
              }
            />
          ))}
        </Card>
      ) : (
        <Card tone="muted" elevated={false} style={styles.emptyCard}>
          <Ionicons name="people-outline" size={26} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            Şu an keşfedilecek yeni üye yok. Birazdan tekrar bakabilirsin.
          </AppText>
        </Card>
      )}

      <Card tone="muted" elevated={false} style={styles.feedEmpty}>
        <View style={[styles.feedIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="sparkles-outline" size={24} color={theme.colors.primaryDeep} />
        </View>
        <AppText variant="h3">Akışın hazır</AppText>
        <AppText variant="body" color="textSecondary" align="center">
          Takip ettiğin kişilerin gönderileri burada listelenecek. Gönderi paylaşımı henüz yayında
          değil.
        </AppText>
      </Card>
    </Screen>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.heroStat}>
      <AppText variant="title" color="#FFFFFF">
        {value.toLocaleString('tr-TR')}
      </AppText>
      <AppText variant="caption" color="rgba(255,255,255,0.75)">
        {label}
      </AppText>
    </View>
  );
}

function MemberRow({
  member,
  isFollowing,
  isPending,
  last,
  onOpen,
  onToggle,
}: {
  member: DirectoryProfile;
  isFollowing: boolean;
  isPending: boolean;
  last: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const { theme } = useTheme();
  const name = `${member.first_name} ${member.last_name}`.trim();
  const place = member.city ?? 'Trabzone';

  return (
    <View
      style={[
        styles.member,
        {
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.divider,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} profilini aç`}
        onPress={onOpen}
        style={styles.memberPerson}
      >
        <Avatar uri={mediaPublicUrl('avatar', member.avatar_path)} name={name} size={44} />

        <View style={styles.memberText}>
          <View style={styles.memberNameRow}>
            <AppText variant="bodyStrong" numberOfLines={1} style={styles.memberName}>
              {name}
            </AppText>
            {member.is_verified ? (
              <Ionicons name="checkmark-circle" size={15} color={theme.colors.primary} />
            ) : null}
          </View>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            @{member.username} · {place}
          </AppText>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isFollowing ? `${name} takibini bırak` : `${name} takip et`}
        accessibilityState={{ selected: isFollowing, busy: isPending }}
        disabled={isPending}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.followButton,
          {
            backgroundColor: isFollowing ? 'transparent' : theme.colors.primary,
            borderColor: isFollowing ? theme.colors.borderStrong : theme.colors.primary,
            borderRadius: theme.radius.pill,
            opacity: isPending ? 0.5 : pressed ? 0.75 : 1,
          },
        ]}
      >
        <AppText variant="label" color={isFollowing ? 'textSecondary' : 'onPrimary'}>
          {isFollowing ? 'Takip ediliyor' : 'Takip et'}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 16,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hero: {
    borderRadius: 26,
    overflow: 'hidden',
  },
  heroContent: { padding: 20, gap: 4 },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.28)',
  },
  heroStat: { flex: 1, gap: 1 },
  heroDivider: {
    width: StyleSheet.hairlineWidth,
    height: 26,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginHorizontal: 12,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 26,
    marginBottom: 10,
  },
  skeleton: { gap: 10 },
  errorCard: { alignItems: 'center', gap: 10 },
  retry: { paddingHorizontal: 16, paddingVertical: 8 },
  membersCard: { overflow: 'hidden' },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  memberText: { flex: 1, gap: 2 },
  memberPerson: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  memberName: { flexShrink: 1 },
  followButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    minHeight: 34,
    justifyContent: 'center',
  },
  emptyCard: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  feedEmpty: { alignItems: 'center', gap: 8, marginTop: 16, paddingVertical: 26, borderWidth: 0 },
  feedIcon: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
});
