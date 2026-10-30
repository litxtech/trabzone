import type { ReactNode } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import { webPageRoot } from '../page-root';
import { WebFooter } from './WebFooter';
import { WebHeader } from './WebHeader';
import { WebPageScroll } from './WebPageScroll';

type PublicShellProps = {
  /** Uygulama başlığında görünen ad. */
  title: string;
  subtitle?: string;
  /** Derin bağlantıyla gelindiğinde geri dönülecek ekran. */
  fallbackHref: string;
  right?: ReactNode;
  /** Web'de içerik `WebPageScroll` (pencere kaydırması) içine alınır. */
  webScroll?: boolean;
  /** Web'de içerik kabına eklenen stil. */
  webContentStyle?: StyleProp<ViewStyle>;
  /** Uygulama içinde kaydırma içeriğine eklenen stil. */
  nativeContentStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * Herkese açık sayfaların (blog, hakkımızda, iletişim, destek, hukuki
 * belgeler, 404) ortak kabuğu.
 *
 * Web'de sayfa herkese açık site başlığı ve alt bilgisiyle (SEO/GEO) çizilir.
 * Uygulama içinde ise bu sayfalar bağımsız birer ekran gibi davranır:
 * geri dönüşlü uygulama başlığı kullanılır, site alt bilgisi (footer) hiç
 * basılmaz ve içerik kendi kaydırma kabında akar.
 *
 * Site alt bilgisi uygulamada basıldığında telefon yüksekliğinin büyük
 * bölümünü kaplıyor ve sayfa içeriğinin üstüne biniyordu; bu yüzden native
 * tarafta tamamen kaldırıldı.
 */
export function PublicShell({
  title,
  subtitle,
  fallbackHref,
  right,
  webScroll = false,
  webContentStyle,
  nativeContentStyle,
  children,
}: PublicShellProps) {
  const { theme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  if (Platform.OS !== 'web') {
    return (
      <SafeAreaView
        style={[styles.nativeRoot, { backgroundColor: theme.colors.background }]}
        edges={['top', 'left', 'right']}
      >
        <View style={styles.nativeHeader}>
          <ScreenHeader
            title={title}
            subtitle={subtitle}
            right={right}
            onBack={() => {
              if (router.canGoBack()) {
                router.back();
                return;
              }
              router.replace(fallbackHref as never);
            }}
          />
        </View>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[{ paddingBottom: insets.bottom + 32 }, nativeContentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <WebHeader />
      {webScroll ? (
        <WebPageScroll contentContainerStyle={webContentStyle}>{children}</WebPageScroll>
      ) : (
        children
      )}
      <WebFooter />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { ...webPageRoot },
  nativeRoot: { flex: 1 },
  nativeHeader: { paddingHorizontal: 8 },
});
