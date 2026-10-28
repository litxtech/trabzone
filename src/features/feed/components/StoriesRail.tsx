import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Skeleton } from '@/components/ui';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useTheme } from '@/theme/ThemeProvider';

import { useStoryFeed } from '../hooks/use-stories';
import type { StoryGroup } from '../services/stories-service';

function StoryTile({ group, onPress }: { group: StoryGroup; onPress: () => void }) {
  const { theme } = useTheme();
  const name = group.is_me ? 'Hikâyen' : (group.first_name ?? group.username);
  const avatar = mediaPublicUrl('avatar', group.avatar_path);
  const seen = !group.has_unseen;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} hikâyesini aç`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.75 : 1 }]}
    >
      <View
        style={[
          styles.ring,
          {
            borderColor: group.has_unseen ? theme.colors.accent : theme.colors.border,
            backgroundColor: theme.colors.surface,
          },
        ]}
      >
        <Avatar uri={avatar} name={name} size={58} recycleKey={group.author_id} />
        {seen ? (
          <View
            style={[
              styles.seenDot,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="checkmark" size={10} color={theme.colors.textSecondary} />
          </View>
        ) : null}
      </View>
      <AppText
        variant="caption"
        color={group.has_unseen ? 'text' : 'textSecondary'}
        numberOfLines={1}
        style={styles.tileName}
      >
        {name}
      </AppText>
    </Pressable>
  );
}

function AddStoryTile({
  onPress,
  avatarUri,
  name,
}: {
  onPress: () => void;
  avatarUri: string | null;
  name: string;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Hikâye oluştur"
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.75 : 1 }]}
    >
      <View
        style={[
          styles.ring,
          { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
        ]}
      >
        <Avatar uri={avatarUri} name={name} size={58} recycleKey={avatarUri} />
        <View
          style={[
            styles.plus,
            { backgroundColor: theme.colors.primary, borderColor: theme.colors.background },
          ]}
        >
          <Ionicons name="add" size={14} color={theme.colors.onPrimary} />
        </View>
      </View>
      <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.tileName}>
        Hikâyen
      </AppText>
    </Pressable>
  );
}

export function StoriesRail({
  onCreate,
  onOpen,
}: {
  onCreate: () => void;
  onOpen: (group: StoryGroup, index: number) => void;
}) {
  const { data: profile } = useMyProfile();
  const { data: groups, isLoading } = useStoryFeed();

  const ownGroup = groups?.find((group) => group.is_me);
  const others = groups?.filter((group) => !group.is_me) ?? [];
  const ownName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : 'Sen';
  const ownAvatar = mediaPublicUrl('avatar', profile?.avatar_path);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        {[0, 1, 2, 3].map((key) => (
          <View key={key} style={styles.loadingTile}>
            <Skeleton height={64} width={64} radius={32} />
            <Skeleton height={9} width={44} radius={4} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      style={styles.scroll}
    >
      {ownGroup && ownGroup.items.length > 0 ? (
        <StoryTile group={ownGroup} onPress={() => onOpen(ownGroup, 0)} />
      ) : (
        <AddStoryTile onPress={onCreate} avatarUri={ownAvatar} name={ownName} />
      )}

      {others.map((group) => (
        <StoryTile key={group.author_id} group={group} onPress={() => onOpen(group, 0)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -4 },
  rail: { gap: 14, paddingHorizontal: 4, paddingVertical: 4 },
  tile: { width: 68, alignItems: 'center', gap: 6 },
  ring: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: { maxWidth: 68, textAlign: 'center' },
  seenDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { flexDirection: 'row', gap: 14, paddingVertical: 4 },
  loadingTile: { alignItems: 'center', gap: 6, width: 68 },
});
