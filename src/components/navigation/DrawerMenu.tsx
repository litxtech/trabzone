import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from '@/utils/router';
import { useCallback, useMemo } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DrawerIdentity } from '@/components/navigation/DrawerIdentity';
import { DrawerDivider, DrawerRow, DrawerSection } from '@/components/navigation/DrawerRow';
import { AppText } from '@/components/ui';
import { useMyRoles } from '@/features/profile/hooks/use-my-profile';
import { useSafetyState } from '@/features/safety/hooks/use-safety';
import { useAuthStore } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

const STAFF_ROLES = ['admin', 'super_admin', 'moderator', 'support_agent'];

export function DrawerMenu({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const signOut = useAuthStore((state) => state.signOut);
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
      keyboardShouldPersistTaps="handled"
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Ana sayfa artik metin satiri degil, en ustte tek bir simge. */}
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ana sayfaya git"
          onPress={() => go('/feed')}
          hitSlop={8}
          style={({ pressed }) => [
            styles.homeButton,
            {
              backgroundColor: pressed ? theme.colors.primarySoft : theme.colors.surfaceMuted,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <Ionicons name="home" size={20} color={theme.colors.primaryDeep} />
        </Pressable>
      </View>

      <DrawerIdentity onPress={() => go('/profile')} caption="Profilini görüntüle" />

      <DrawerSection title="Keşfet">
        <DrawerRow
          icon="compass"
          label="Trabzon Keşfet"
          hint="İşletmeler · Emlak · Alan arama"
          tone="primary"
          onPress={() => go('/explore')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="map"
          label="Etkileşim Haritası"
          hint="Arkadaşlar · Yolculuk · Mekân"
          onPress={() => go('/map')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="home-outline"
          label="Trabzone Emlak"
          onPress={() => go('/marketplace/real-estate')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="storefront-outline"
          label="Marketplace"
          onPress={() => go('/marketplace')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="newspaper-outline"
          label="Trabzon Blog"
          hint="Gezi · Yaşam · Yerel rehberler"
          onPress={() => go('/blog')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="receipt-outline"
          label="Siparişlerim"
          onPress={() => go('/marketplace/orders')}
        />
      </DrawerSection>

      <DrawerSection title="Konaklama">
        <DrawerRow
          icon="bed-outline"
          label="Konaklama Keşfet"
          hint="Oteller · Bungalovlar · Villalar"
          tone="primary"
          onPress={() => go('/konaklama')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="map-outline"
          label="Haritada Oteller"
          onPress={() => go('/konaklama/harita')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="calendar-outline"
          label="Rezervasyonlarım"
          onPress={() => go('/konaklama/rezervasyonlarim')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="add-circle-outline"
          label="Otelimi Ekle"
          hint="Ücretsiz tesis kaydı"
          onPress={() => go('/konaklama/otel-ekle')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="business-outline"
          label="Otel Yönetimim"
          hint="Rezervasyon · Takvim · Finans"
          onPress={() => go('/konaklama/yonetim')}
        />
      </DrawerSection>

      <DrawerSection title="Yolculuk">
        <DrawerRow
          icon="car-sport"
          label="Yolculuk Paylaşımı"
          hint="Ara · Paylaş · Rezervasyon"
          tone="primary"
          onPress={() => go('/ride')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="navigate-outline"
          label="Yolculuk ara"
          onPress={() => go('/ride/search')}
        />
        <DrawerDivider />
        <DrawerRow icon="albums-outline" label="Yolculuklarım" onPress={() => go('/ride/trips')} />
        <DrawerDivider />
        <DrawerRow
          icon="repeat-outline"
          label="Düzenli yolculuklar"
          onPress={() => go('/ride/recurring')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="shield-half-outline"
          label="Güvenlik merkezi"
          onPress={() => go('/ride/safety')}
        />
      </DrawerSection>

      <DrawerSection title="Sağlık">
        <DrawerRow
          icon="medkit"
          label="Eczaneler"
          hint="Nöbetçi eczane · Adres · Yol tarifi"
          tone="primary"
          onPress={() => go('/eczaneler')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="map-outline"
          label="Nöbetçi eczane haritası"
          onPress={() => go('/eczaneler/harita')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="pulse-outline"
          label="Deprem Merkezi"
          hint="Trabzon ve çevresindeki son depremler"
          onPress={() => go('/deprem')}
        />
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
          onPress={() => go('/settings/privacy')}
        />
        <DrawerDivider />
        <DrawerRow
          icon="lock-closed-outline"
          label="Çocuk güvenliği ayarları"
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
        <DrawerRow
          icon="log-out-outline"
          label="Çıkış Yap"
          tone="danger"
          onPress={confirmSignOut}
        />
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
  content: { paddingHorizontal: 12, paddingTop: 10, gap: 18 },
  topBar: { flexDirection: 'row', alignItems: 'center' },
  homeButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { gap: 10, paddingTop: 4 },
  legal: { opacity: 0.8 },
});
