import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DrawerIdentity } from '@/components/navigation/DrawerIdentity';
import { DrawerDivider, DrawerRow, DrawerSection } from '@/components/navigation/DrawerRow';
import { AppText } from '@/components/ui';
import { useMyRoles } from '@/features/profile/hooks/use-my-profile';
import { useSafetyState } from '@/features/safety/hooks/use-safety';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore, type ThemeMode } from '@/stores/settings-store';

const THEME_LABEL: Record<ThemeMode, string> = {
  system: 'Sistem',
  light: 'Açık',
  dark: 'Koyu',
};

const STAFF_ROLES = ['admin', 'super_admin', 'moderator', 'support_agent'];

export function DrawerMenu({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const signOut = useAuthStore((state) => state.signOut);
  const themeMode = useSettingsStore((state) => state.themeMode);
  const { data: roles } = useMyRoles();
  const { data: safety } = useSafetyState();

  const isStaff = useMemo(
    () => roles?.some((role) => STAFF_ROLES.includes(role)) ?? false,
    [roles],
  );

  const go = useCallback(
    (href: string) => {
      onClose();
      router.navigate(href as never);
    },
    [onClose, router],
  );

  const confirmSignOut = useCallback(() => {
    onClose();
    // Alert on web has no confirm flow, sign out directly there.
    if (Platform.OS === 'web') {
      void signOut();
      return;
    }
    Alert.alert('Çıkış yap', 'Hesabından çıkmak istediğine emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Çıkış Yap', style: 'destructive', onPress: () => void signOut() },
    ]);
  }, [onClose, signOut]);

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
      showsVerticalScrollIndicator={false}
    >
      <DrawerIdentity onPress={() => go('/profile')} caption="Profilini görüntüle" />

      <DrawerSection title="Hesap">
        <DrawerRow icon="person-outline" label="Profilim" onPress={() => go('/profile')} />
        <DrawerDivider />
        <DrawerRow icon="settings-outline" label="Ayarlar" onPress={() => go('/settings')} />
        <DrawerDivider />
        <DrawerRow
          icon="contrast-outline"
          label="Görünüm"
          hint={`Tema: ${THEME_LABEL[themeMode]}`}
          onPress={() => go('/settings/appearance')}
        />
      </DrawerSection>

      <DrawerSection title="Keşfet">
        <DrawerRow icon="home-outline" label="Ana Sayfa" onPress={() => go('/feed')} />
        <DrawerDivider />
        <DrawerRow icon="storefront-outline" label="Marketplace" onPress={() => go('/marketplace')} />
        <DrawerDivider />
        <DrawerRow icon="chatbubbles-outline" label="Mesajlarım" onPress={() => go('/messages')} />
      </DrawerSection>

      <DrawerSection title="Destek ve güvenlik">
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
          icon="shield-checkmark-outline"
          label="Güvenlik ve gizlilik"
          onPress={() => go('/settings/child-safety')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="document-text-outline"
          label="Çocuk güvenliği politikası"
          onPress={() => go('/policy/child-safety')}
        />
      </DrawerSection>

      {isStaff ? (
        <DrawerSection title="Yönetim">
          <DrawerRow
            icon="grid-outline"
            label="Yönetim paneli"
            hint="Yetkili personel"
            tone="primary"
            onPress={() => go('/admin')}
          />
        </DrawerSection>
      ) : null}

      <View style={styles.bottom}>
        <DrawerRow icon="log-out-outline" label="Çıkış Yap" tone="danger" onPress={confirmSignOut} />
        <AppText variant="caption" color="textTertiary" align="center">
          Trabzone v{version}
        </AppText>
        <AppText variant="caption" color="textTertiary" align="center" style={styles.legal}>
          Topluluk güvenliği önceliğimizdir.
        </AppText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 12, gap: 18 },
  bottom: { gap: 10, paddingTop: 4 },
  legal: { opacity: 0.8 },
});
