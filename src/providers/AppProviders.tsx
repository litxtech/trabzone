import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type PropsWithChildren } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DocumentViewerProvider } from '@/features/documents/viewer';
import { ReportSheetProvider } from '@/features/safety/components/ReportSheetProvider';
import { KeyboardProvider } from '@/providers/keyboard';
import { WebSafeAreaGuard } from '@/providers/web-safe-area';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { installWebAlertFallback } from '@/utils/platform-alert';

// Web'de `Alert.alert` sessizce yutuluyordu (silme/onay akışları çalışmıyordu).
// Ekranlardan önce bir kez kurulur.
installWebAlertFallback();

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Sekme degisimi ve geri donuslerde gereksiz istek atilmaz;
            // veri tazeyse bellekten okunur, ekran aninda boyanir.
            staleTime: 60_000,
            gcTime: 10 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <WebSafeAreaGuard>
          <KeyboardProvider>
            <ThemeProvider>
              <QueryClientProvider client={queryClient}>
                {/* Belgeler (kimlik, ruhsat, destek eki) tarayıcıya çıkmadan
                    uygulama içinde açılır; sağlayıcı tüm ekranlara hizmet eder. */}
                <ReportSheetProvider>
                  <DocumentViewerProvider>{children}</DocumentViewerProvider>
                </ReportSheetProvider>
              </QueryClientProvider>
            </ThemeProvider>
          </KeyboardProvider>
        </WebSafeAreaGuard>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
