import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar } from '@/components/ui';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  onPress: () => void;
  caption?: string;
};

/** Drawer'in ust kimlik karti. Avatar + isim + kullanici adi. */
export function DrawerIdentity({ onPress, caption }: Props) {
  const { theme } = useTheme();
  const { data: profile } = useMyProfile();

  const fullName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : 'Trabzone üyesi';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Profilime git"
      onPress={onPress}
      style={({ pressed }) => [
        styles.root,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Avatar name={fullName} size={52} ring />

      <View style={styles.text}>
        <View style={styles.nameRow}>
          <AppText variant="title" numberOfLines={1} style={styles.name}>
            {fullName}
          </AppText>
          {profile?.is_verified ? (
            <Ionicons name="checkmark-circle" size={16} color={theme.colors.primary} />
          ) : null}
        </View>
        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
          {profile ? `@${profile.username}` : 'Profil yükleniyor'}
        </AppText>
        {caption ? (
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {caption}
          </AppText>
        ) : null}
      </View>

      <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { flexShrink: 1 },
});
