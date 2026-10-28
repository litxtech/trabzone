import { Redirect, usePathname } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

import { loginHref } from '../next-path';

/**
 * Oturum gerektiren rota gruplarini korur. Uygulama acilisinda oturum
 * okunurken bos ekran yerine kisa bir yukleme durumu gosterilir; boylece
 * kullanici bir an icin lobby'ye yonlendirilip geri atilmaz ve "bos ekranda
 * bekliyor" hissi olusmaz.
 *
 * Oturum yoksa kullanici dogrudan giris formuna gonderilir ve acilmak istenen
 * adres `next` parametresinde tasinir (ornegin `/login?next=/marketplace/abc`).
 * Giriş tamamlandiginda ayni ilan acilir; derin baglantilar ve paylasilan
 * ilan adresleri boylece kaybolmaz.
 */
export function AuthGate({ children }: PropsWithChildren) {
  const status = useAuthStatus();
  const pathname = usePathname();

  if (status === 'booting') {
    return <AuthGateLoading />;
  }
  if (status !== 'authenticated') {
    return <Redirect href={loginHref(pathname)} />;
  }
  return children;
}

function AuthGateLoading() {
  const { theme } = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ActivityIndicator color={theme.colors.primary} />
      <AppText variant="caption" color="textSecondary">
        Oturum hazırlanıyor…
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
    minHeight: '100%',
  },
});
