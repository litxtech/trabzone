import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AnimatedSplash } from '@/features/splash/components/AnimatedSplash';
import { useAppBootstrap } from '@/features/splash/hooks/use-app-bootstrap';
import { useWebScrollFix } from '@/features/web/use-web-scroll-fix';
import { perf } from '@/perf';
import { useReduceMotion } from '@/perf/use-reduce-motion';
import { AppProviders } from '@/providers/AppProviders';
import { useTheme } from '@/theme/ThemeProvider';

// Keep the native splash until fonts + session are ready, then hand over to the
// animated brand intro so the user never sees a blank frame.
SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 120, fade: true });

function RootNavigator() {
  const { theme, scheme } = useTheme();
  const reduceMotion = useReduceMotion();

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          // Yigma gecisleri native push hizinda; fade/blur yok, siyah kare yok.
          // Animasyonlari kaldiran kullanicilarda gecis tamamen atlanir.
          animation: reduceMotion ? 'none' : 'slide_from_right',
          animationDuration: perf.screenTransitionMs,
          gestureEnabled: !reduceMotion,
        }}
      >
        {/* Acilistaki oturum gecisleri animasyonsuz: splash'ten uygulamaya
            gecerken ekran kararmasi/fade'i olusmaz. */}
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="(auth)" options={{ animation: 'none' }} />
        <Stack.Screen name="(app)" options={{ animation: 'none' }} />
        <Stack.Screen name="support" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="policy" />
        <Stack.Screen name="admin" />
      </Stack>
    </>
  );
}

function RootLayoutInner() {
  const { ready } = useAppBootstrap();
  const [introVisible, setIntroVisible] = useState(true);
  const handleIntroFinish = useCallback(() => setIntroVisible(false), []);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [ready]);

  return (
    <>
      {ready ? <RootNavigator /> : null}
      {introVisible ? <AnimatedSplash ready={ready} onFinish={handleIntroFinish} /> : null}
      {/* Emniyet kemeri: intro bittiyse ama oturum/font hazırlığı hâlâ
          sürüyorsa ekran boş kalmasın. */}
      {!ready && !introVisible ? <BootFallback /> : null}
    </>
  );
}

function BootFallback() {
  return (
    <View style={styles.boot}>
      <Text style={styles.bootBrand}>TRABZONE</Text>
      <Text style={styles.bootHint}>Yükleniyor…</Text>
    </View>
  );
}

/**
 * Beklenmeyen bir çizim hatası React ağacını sökebiliyor; bu durumda beyaz/boş
 * ekran yerine kullanıcıya yeniden deneme seçeneği gösterilir.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.boot}>
      <Text style={styles.bootBrand}>TRABZONE</Text>
      <Text style={styles.bootTitle}>Bir şeyler ters gitti</Text>
      <Text style={styles.bootHint} numberOfLines={3}>
        {error?.message || 'Sayfa yüklenemedi.'}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Tekrar dene"
        onPress={retry}
        style={styles.bootButton}
      >
        <Text style={styles.bootButtonLabel}>Tekrar dene</Text>
      </Pressable>
      {Platform.OS === 'web' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sayfayı yenile"
          onPress={() => {
            if (typeof window !== 'undefined') {
              window.location.reload();
            }
          }}
          style={styles.bootLink}
        >
          <Text style={styles.bootHint}>Sayfayı yenile</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    minHeight: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 28,
    backgroundColor: '#0B1020',
  },
  bootBrand: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', letterSpacing: 4 },
  bootTitle: { color: '#EAF0FF', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  bootHint: { color: '#93A4C7', fontSize: 13, textAlign: 'center' },
  bootButton: {
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#6284FF',
  },
  bootButtonLabel: { color: '#06101F', fontSize: 14, fontWeight: '700' },
  bootLink: { paddingVertical: 6 },
});

export default function RootLayout() {
  useWebScrollFix();

  return (
    <AppProviders>
      <RootLayoutInner />
    </AppProviders>
  );
}
