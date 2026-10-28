import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Screen, ScreenHeader, Skeleton, TextField } from '@/components/ui';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useDiscoverPeople } from '@/features/discovery/hooks/use-discover';
import type { DiscoverProfile, DiscoverSort } from '@/features/discovery/services/discover-service';
import { PROVINCES } from '@/features/profile/constants/regions';
import { useFollowingIds, useToggleFollow } from '@/features/profile/hooks/use-follow';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useStartDirectConversation } from '@/features/messaging/hooks/use-chat';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

const SORTS: { key: DiscoverSort; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'popular', label: 'Popüler', icon: 'flame-outline' },
  { key: 'new', label: 'Yeni üyeler', icon: 'sparkles-outline' },
  { key: 'city', label: 'Şehir', icon: 'location-outline' },
];

export default function DiscoverScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { data: profile } = useMyProfile();
  const { data: followingIds } = useFollowingIds();
  const toggleFollow = useToggleFollow();
  const startChat = useStartDirectConversation();

  const [query, setQuery] = useState('');
  const [city, setCity] = useState<string | null>(null);
  const [sort, setSort] = useState<DiscoverSort>('popular');
  const [cityOpen, setCityOpen] = useState(false);

  const debouncedQuery = useDebouncedValue(query, 350);
  const effectiveCity = sort === 'city' ? city : null;
  const discovery = useDiscoverPeople({ query: debouncedQuery, city: effectiveCity, sort });

  const following = new Set(followingIds ?? []);
  const profiles = discovery.data ?? [];

  const openChat = useCallback(
    (person: DiscoverProfile) => {
      startChat.mutate(person.id, {
        onSuccess: ({ id }) => router.push(`/chat/${id}` as never),
      });
    },
    [router, startChat],
  );

  return (
    <Screen
      edges={['top', 'left', 'right']}
      scroll
      refreshControl={
        <RefreshControl
          refreshing={discovery.isRefetching}
          onRefresh={() => void discovery.refetch()}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <ScreenHeader title="Keşfet" subtitle="Yeni insanlar, yeni bağlantılar" onBack={() => router.back()} />

      <TextField
        placeholder="İsim veya kullanıcı adı ara"
        value={query}
        onChangeText={setQuery}
        leftIcon="search-outline"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />

      <View style={styles.sortRow}>
        {SORTS.map((item) => {
          const active = sort === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
              onPress={() => {
                haptics.selection();
                setSort(item.key);
                if (item.key === 'city' && !city) {
                  setCityOpen(true);
                }
              }}
              style={({ pressed }) => [
                styles.sortPill,
                {
                  backgroundColor: active ? theme.colors.primary : theme.colors.surface,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={14}
                color={active ? theme.colors.onPrimary : theme.colors.textSecondary}
              />
              <AppText variant="label" color={active ? 'onPrimary' : 'textSecondary'}>
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {sort === 'city' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Şehir seç"
          onPress={() => setCityOpen(true)}
          style={({ pressed }) => [
            styles.cityRow,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Ionicons name="location-outline" size={17} color={theme.colors.textSecondary} />
          <AppText variant="body" color={city ? 'text' : 'textTertiary'} style={styles.cityLabel}>
            {city ?? profile?.city ?? 'Şehir seç'}
          </AppText>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
        </Pressable>
      ) : null}

      {discovery.isLoading ? (
        <View style={styles.skeletons}>
          {[0, 1, 2, 3, 4].map((key) => (
            <Skeleton key={key} height={70} radius={18} />
          ))}
        </View>
      ) : discovery.isError ? (
        <View style={styles.state}>
          <Ionicons name="cloud-offline-outline" size={28} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            Keşfet yüklenemedi. Tekrar denemek için dokun.
          </AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Tekrar dene" onPress={() => void discovery.refetch()}>
            <AppText variant="label" color="primaryDeep">
              Tekrar dene
            </AppText>
          </Pressable>
        </View>
      ) : profiles.length === 0 ? (
        <View style={styles.state}>
          <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="people-outline" size={24} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="bodyStrong" align="center">
            Sonuç bulunamadı
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Farklı bir isim veya şehir deneyebilirsin.
          </AppText>
        </View>
      ) : (
        <View style={styles.list}>
          {profiles.map((person) => {
            const name =
              `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || person.username;
            const isFollowing = following.has(person.id);
            const pending =
              toggleFollow.isPending && toggleFollow.variables?.userId === person.id;

            return (
              <View
                key={person.id}
                style={[
                  styles.card,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${name} profilini aç`}
                  onPress={() => router.push(`/profile/${person.username}` as never)}
                  style={styles.person}
                >
                  <Avatar uri={mediaPublicUrl('avatar', person.avatar_path)} name={name} size={48} />
                  <View style={styles.personText}>
                    <View style={styles.nameRow}>
                      <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
                        {name}
                      </AppText>
                      {person.is_verified ? (
                        <Ionicons name="checkmark-circle" size={14} color={theme.colors.primary} />
                      ) : null}
                    </View>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      @{person.username}
                      {person.city ? ` · ${person.city}` : ''}
                    </AppText>
                    {person.bio ? (
                      <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                        {person.bio}
                      </AppText>
                    ) : null}
                  </View>
                </Pressable>

                <View style={styles.cardActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={isFollowing ? 'Takibi bırak' : 'Takip et'}
                    accessibilityState={{ selected: isFollowing, busy: pending }}
                    disabled={pending}
                    onPress={() => {
                      haptics.tap();
                      toggleFollow.mutate({ userId: person.id, follow: !isFollowing });
                    }}
                    style={({ pressed }) => [
                      styles.actionButton,
                      {
                        backgroundColor: isFollowing ? 'transparent' : theme.colors.primarySoft,
                        borderColor: isFollowing ? theme.colors.border : theme.colors.primarySoft,
                        opacity: pending ? 0.5 : pressed ? 0.75 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={isFollowing ? 'checkmark' : 'person-add-outline'}
                      size={14}
                      color={isFollowing ? theme.colors.textSecondary : theme.colors.primaryDeep}
                    />
                    <AppText
                      variant="caption"
                      color={isFollowing ? 'textSecondary' : 'primaryDeep'}
                    >
                      {isFollowing ? 'Takip' : 'Takip et'}
                    </AppText>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${name} kullanıcısına mesaj gönder`}
                    disabled={startChat.isPending}
                    onPress={() => openChat(person)}
                    style={({ pressed }) => [
                      styles.iconAction,
                      {
                        backgroundColor: theme.colors.surfaceMuted,
                        opacity: startChat.isPending ? 0.5 : pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Ionicons name="chatbubble-outline" size={16} color={theme.colors.text} />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {startChat.isPending ? (
        <ActivityIndicator color={theme.colors.primary} style={styles.busy} />
      ) : null}

      <SelectSheet
        visible={cityOpen}
        title="Şehir seç"
        options={PROVINCES}
        value={city}
        onClose={() => setCityOpen(false)}
        onSelect={(value) => {
          setCity(value);
          setSort('city');
          setCityOpen(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sortRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
  },
  cityLabel: { flex: 1 },
  list: { gap: 8, marginTop: 14 },
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  person: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  personText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
  },
  iconAction: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletons: { gap: 9, marginTop: 14 },
  state: { paddingVertical: 44, alignItems: 'center', gap: 9 },
  stateIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  busy: { paddingVertical: 16 },
});
