import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Card, IconButton, Screen } from '@/components/ui';
import { useIncomingFriendRequestCount } from '@/features/profile/hooks/use-friend-requests';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { SUPPORT_EMAIL } from '@/features/safety/constants';
import { useAuthStore, useSession } from '@/stores/auth-store';
import { useSettingsStore, type ThemeMode } from '@/stores/settings-store';
import { useTheme } from '@/theme/ThemeProvider';

const THEME_LABEL: Record<ThemeMode, string> = {
  system: 'Sistem',
  light: 'Açık',
  dark: 'Koyu',
};

export default function SettingsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const session = useSession();
  const signOut = useAuthStore((state) => state.signOut);
  const themeMode = useSettingsStore((state) => state.themeMode);
  const { data: profile } = useMyProfile();
  const pendingRequests = useIncomingFriendRequestCount();

  const fullName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : 'Trabzone üyesi';
  const email = session?.user.email ?? '—';
  const avatarUrl = mediaPublicUrl('avatar', profile?.avatar_path);

  const confirmSignOut = () => {
    if (Platform.OS === 'web') {
      void signOut();
      return;
    }
    Alert.alert('Çıkış yap', 'Hesabından çıkmak istediğine emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Çıkış Yap', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Geri"
          variant="surface"
          size={20}
          onPress={() => router.back()}
        />
        <AppText variant="h3">Ayarlar</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <Card style={styles.accountCard}>
        <Avatar uri={avatarUrl} name={fullName} size={54} ring />
        <View style={styles.accountText}>
          <AppText variant="title" numberOfLines={1}>
            {fullName}
          </AppText>
          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
            {profile ? `@${profile.username}` : 'Profil yükleniyor'}
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {email}
          </AppText>
        </View>
      </Card>

      <View style={styles.section}>
        <AppText variant="overline" color="textTertiary" style={styles.sectionTitle}>
          HESAP
        </AppText>
        <Card padding={0}>
          <SettingRow
            icon="person-circle-outline"
            label="Profili düzenle"
            onPress={() => router.push('/settings/edit-profile')}
          />
          <Divider />
          <SettingRow
            icon="lock-closed-outline"
            label="Gizlilik"
            onPress={() => router.push('/settings/privacy')}
          />
          <Divider />
          <SettingRow
            icon="people-outline"
            label="Arkadaşlıklar"
            value={pendingRequests > 0 ? `${pendingRequests} istek` : undefined}
            onPress={() => router.push('/settings/friends')}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="overline" color="textTertiary" style={styles.sectionTitle}>
          GÖRÜNÜM
        </AppText>
        <Card padding={0}>
          <SettingRow
            icon="contrast-outline"
            label="Tema ve simge"
            value={THEME_LABEL[themeMode]}
            onPress={() => router.push('/settings/appearance')}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="overline" color="textTertiary" style={styles.sectionTitle}>
          GÜVENLİK VE DESTEK
        </AppText>
        <Card padding={0}>
          <SettingRow
            icon="shield-checkmark-outline"
            label="Güvenlik ve gizlilik"
            onPress={() => router.push('/settings/child-safety')}
          />
          <Divider />
          <SettingRow
            icon="headset-outline"
            label="Destek merkezi"
            value="Talepte bulun"
            onPress={() => router.push('/support')}
          />
          <Divider />
          <SettingRow
            icon="clipboard-outline"
            label="Başvurularım"
            onPress={() => router.push('/support/my-requests')}
          />
          <Divider />
          <SettingRow
            icon="document-text-outline"
            label="Çocuk güvenliği politikası"
            onPress={() => router.push('/policy/child-safety')}
          />
          <Divider />
          <SettingRow
            icon="mail-outline"
            label="Destek e-postası"
            value={SUPPORT_EMAIL}
            onPress={() => router.push('/support')}
          />
        </Card>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Çıkış yap"
        onPress={confirmSignOut}
        style={({ pressed }) => [
          styles.signOut,
          {
            backgroundColor: theme.colors.dangerSoft,
            borderColor: theme.colors.dangerSoft,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <Ionicons name="log-out-outline" size={19} color={theme.colors.danger} />
        <AppText variant="bodyStrong" color="danger">
          Çıkış Yap
        </AppText>
      </Pressable>
    </Screen>
  );
}

function SettingRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value?: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent' },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name={icon} size={18} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="bodyStrong" style={styles.rowLabel}>
        {label}
      </AppText>
      {value ? (
        <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.rowValue}>
          {value}
        </AppText>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

function Divider() {
  const { theme } = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginLeft: 54,
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 16,
  },
  headerSpacer: { width: 44 },
  accountCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  accountText: { flex: 1, gap: 2 },
  section: { marginTop: 20, gap: 8 },
  sectionTitle: { paddingHorizontal: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 50,
  },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1 },
  rowValue: { maxWidth: 150 },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 26,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
