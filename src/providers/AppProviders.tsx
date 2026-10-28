import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type PropsWithChildren } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ReportSheetProvider } from '@/features/safety/components/ReportSheetProvider';
import { KeyboardProvider } from '@/providers/keyboard';
import { ThemeProvider } from '@/theme/ThemeProvider';

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
        <KeyboardProvider>
          <ThemeProvider>
            <QueryClientProvider client={queryClient}>
              <ReportSheetProvider>{children}</ReportSheetProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
