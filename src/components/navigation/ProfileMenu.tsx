import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DrawerIdentity } from '@/components/navigation/DrawerIdentity';
import { DrawerDivider, DrawerRow, DrawerSection } from '@/components/navigation/DrawerRow';
import { AppText } from '@/components/ui';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useSafetyState } from '@/features/safety/hooks/use-safety';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore, type ThemeMode } from '@/stores/settings-store';

const THEME_LABEL: Record<ThemeMode, string> = {
  system: 'Sistem',
  light: 'Açık',
  dark: 'Koyu',
};

/**
 * Profil ekraninin kendi drawer'i. Ana menuden farkli olarak profil
 * islemlerine odaklanir; ayni animasyon altyapisini kullanir.
 */
export function ProfileMenu({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const signOut = useAuthStore((state) => state.signOut);
  const themeMode = useSettingsStore((state) => state.themeMode);
  const { data: profile } = useMyProfile();
  const { data: safety } = useSafetyState();

  const go = useCallback(
    (href: string) => {
      onClose();
      router.navigate(href as never);
    },
    [onClose, router],
  );

  const confirmSignOut = useCallback(() => {
    onClose();
    if (Platform.OS === 'web') {
      void signOut();
      return;
    }
    Alert.alert('Çıkış yap', 'Hesabından çıkmak istediğine emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Çıkış Yap', style: 'destructive', onPress: () => void signOut() },
    ]);
  }, [onClose, signOut]);

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
      showsVerticalScrollIndicator={false}
    >
      <DrawerIdentity onPress={() => go('/profile')} caption="Profil kartın" />

      <DrawerSection title="Profil">
        <DrawerRow
          icon="at-outline"
          label="Kullanıcı adı"
          hint={profile ? `@${profile.username}` : 'Yükleniyor'}
          onPress={() => go('/settings')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="information-circle-outline"
          label="Hesap bilgileri"
          onPress={() => go('/settings')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="shield-checkmark-outline"
          label="Gizlilik ve güvenlik"
          hint={safety?.is_child_protected ? 'Koruma aktif' : undefined}
          onPress={() => go('/settings/child-safety')}
        />
      </DrawerSection>

      <DrawerSection title="Görünüm">
        <DrawerRow
          icon="contrast-outline"
          label="Tema"
          hint={`Şu an: ${THEME_LABEL[themeMode]}`}
          onPress={() => go('/settings/appearance')}
        />
      </DrawerSection>

      <DrawerSection title="Destek">
        <DrawerRow
          icon="headset-outline"
          label="Yardım ve Destek"
          tone="primary"
          onPress={() => go('/support')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="clipboard-outline"
          label="Başvurularım"
          badge={safety?.notifications_unread ?? 0}
          onPress={() => go('/support/my-requests')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="document-text-outline"
          label="Çocuk güvenliği politikası"
          onPress={() => go('/policy/child-safety')}
        />
      </DrawerSection>

      <View style={styles.bottom}>
        <DrawerRow icon="log-out-outline" label="Çıkış Yap" tone="danger" onPress={confirmSignOut} />
        <AppText variant="caption" color="textTertiary" align="center">
          Trabzone
        </AppText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 12, gap: 18 },
  bottom: { gap: 10, paddingTop: 4 },
});
