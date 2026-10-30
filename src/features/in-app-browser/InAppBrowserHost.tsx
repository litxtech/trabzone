import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Modal, Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import type { WebViewNavigation } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, AppText, Button, IconButton } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { loadWebView, type WebViewHandle } from './native';
import { useInAppBrowserStore } from './store';

const NativeWebView = loadWebView();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Uygulama içi tarayıcı kartı. Kök düzende bir kez bağlanır; `openUrl` ile
 * açılan tüm web adresleri burada, uygulamadan çıkmadan görüntülenir.
 */
export function InAppBrowserHost() {
  const visible = useInAppBrowserStore((state) => state.visible);
  const url = useInAppBrowserStore((state) => state.url);
  const title = useInAppBrowserStore((state) => state.title);
  const session = useInAppBrowserStore((state) => state.session);
  const openedAt = useInAppBrowserStore((state) => state.openedAt);
  const close = useInAppBrowserStore((state) => state.close);
  const backHandler = useRef<(() => boolean) | null>(null);

  if (!url || !NativeWebView) {
    return null;
  }

  const isIos = Platform.OS === 'ios';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      // iOS'ta yerel sayfa kartı kullanılır; aşağı kaydırarak kapanır.
      presentationStyle={isIos ? 'pageSheet' : undefined}
      transparent={!isIos}
      statusBarTranslucent={!isIos}
      navigationBarTranslucent={!isIos}
      onRequestClose={() => {
        // Android geri tuşu önce sayfa geçmişinde geri gider.
        if (!isIos && backHandler.current?.()) {
          return;
        }
        close();
      }}
    >
      <BrowserCard
        key={session}
        initialUrl={url}
        initialTitle={title}
        openedAt={openedAt}
        onClose={close}
        registerBack={(handler) => {
          backHandler.current = handler;
        }}
      />
    </Modal>
  );
}

type BrowserCardProps = {
  initialUrl: string;
  initialTitle: string | null;
  openedAt: number;
  onClose: () => void;
  registerBack: (handler: (() => boolean) | null) => void;
};

function BrowserCard({ initialUrl, initialTitle, openedAt, onClose, registerBack }: BrowserCardProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebViewHandle>(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [pageTitle, setPageTitle] = useState(initialTitle);
  const [canGoBack, setCanGoBack] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const isIos = Platform.OS === 'ios';
  const secure = currentUrl.startsWith('https://');

  useEffect(() => {
    registerBack(() => {
      if (canGoBack) {
        webRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => registerBack(null);
  }, [canGoBack, registerBack]);

  const onNavigation = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
    if (nav.url) {
      setCurrentUrl(nav.url);
    }
    if (nav.title && !/^https?:\/\//i.test(nav.title)) {
      setPageTitle(nav.title);
    }
  }, []);

  const reload = useCallback(() => {
    setFailed(false);
    webRef.current?.reload();
  }, []);

  const openExternally = useCallback(() => {
    void Linking.openURL(currentUrl).catch(() => undefined);
  }, [currentUrl]);

  /** Arka plana dokunma; açılışın hemen ardından gelen artık dokunuşu yutar. */
  const dismissFromBackdrop = useCallback(() => {
    if (Date.now() - openedAt < 350) {
      return;
    }
    onClose();
  }, [onClose, openedAt]);

  const onMenuSelect = useCallback(
    (key: string) => {
      setMenuOpen(false);
      if (key === 'reload') {
        reload();
      } else if (key === 'share') {
        void Share.share(isIos ? { url: currentUrl } : { message: currentUrl }).catch(() => undefined);
      } else if (key === 'copy') {
        void Clipboard.setStringAsync(currentUrl).then(() => haptics.success());
      } else if (key === 'external') {
        openExternally();
      }
    },
    [currentUrl, isIos, openExternally, reload],
  );

  if (!NativeWebView) {
    return null;
  }

  const card = (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface },
        isIos
          ? null
          : {
              marginTop: insets.top + 8,
              paddingBottom: insets.bottom,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
            },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
        <IconButton name="close" accessibilityLabel="Kapat" onPress={onClose} />
        <View style={styles.titleBlock}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {pageTitle || hostOf(currentUrl)}
          </AppText>
          <View style={styles.hostRow}>
            <Ionicons
              name={secure ? 'lock-closed' : 'warning-outline'}
              size={11}
              color={secure ? theme.colors.textTertiary : theme.colors.warning}
            />
            <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
              {hostOf(currentUrl)}
            </AppText>
          </View>
        </View>
        {canGoBack ? (
          <IconButton
            name="chevron-back"
            accessibilityLabel="Önceki sayfa"
            onPress={() => webRef.current?.goBack()}
          />
        ) : null}
        <IconButton
          name="ellipsis-horizontal"
          accessibilityLabel="Sayfa seçenekleri"
          onPress={() => setMenuOpen(true)}
        />
      </View>

      <View style={[styles.progressTrack, { opacity: progress > 0 && progress < 1 ? 1 : 0 }]}>
        <View
          style={[
            styles.progressBar,
            { width: `${Math.round(progress * 100)}%`, backgroundColor: theme.colors.primary },
          ]}
        />
      </View>

      <View style={styles.flex}>
        <NativeWebView
          ref={webRef}
          source={{ uri: initialUrl }}
          style={[styles.flex, { backgroundColor: theme.colors.background }]}
          onNavigationStateChange={onNavigation}
          onLoadStart={() => setFailed(false)}
          onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
          onError={() => setFailed(true)}
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          pullToRefreshEnabled
          decelerationRate="normal"
        />
        {failed ? (
          <View style={[styles.error, { backgroundColor: theme.colors.surface }]}>
            <Ionicons name="cloud-offline-outline" size={36} color={theme.colors.textTertiary} />
            <AppText variant="bodyStrong" align="center">
              Sayfa yüklenemedi
            </AppText>
            <AppText variant="caption" color="textSecondary" align="center">
              Bağlantını kontrol edip tekrar dene.
            </AppText>
            <View style={styles.errorActions}>
              <Button label="Tekrar dene" size="sm" fullWidth={false} onPress={reload} />
              <Button
                label="Tarayıcıda aç"
                size="sm"
                variant="outline"
                fullWidth={false}
                onPress={openExternally}
              />
            </View>
          </View>
        ) : null}
      </View>

      <ActionSheet
        visible={menuOpen}
        title={hostOf(currentUrl)}
        items={[
          { key: 'reload', label: 'Yenile', icon: 'refresh-outline' },
          { key: 'share', label: 'Paylaş', icon: 'share-outline' },
          { key: 'copy', label: 'Bağlantıyı kopyala', icon: 'copy-outline' },
          { key: 'external', label: 'Tarayıcıda aç', icon: 'open-outline' },
        ]}
        onSelect={onMenuSelect}
        onClose={() => setMenuOpen(false)}
      />
    </View>
  );

  if (isIos) {
    return card;
  }

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Kartı kapat"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
        onPress={dismissFromBackdrop}
      />
      {card}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  flex: { flex: 1 },
  card: { flex: 1, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleBlock: { flex: 1, gap: 1, paddingHorizontal: 4 },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  progressTrack: { height: 2 },
  progressBar: { height: 2 },
  error: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 28,
  },
  errorActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
});
