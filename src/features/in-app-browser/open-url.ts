import { Linking, Platform } from 'react-native';

import { loadWebBrowser, loadWebView } from './native';
import { useInAppBrowserStore } from './store';

export type OpenUrlOptions = {
  /** Sayfa başlığı yüklenene kadar kartta gösterilen başlık. */
  title?: string | null;
};

export function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

/**
 * Platform genelinde bağlantı açmanın tek yolu.
 *
 * - `http(s)` adresleri uygulamadan çıkmadan, uygulama içi tarayıcı kartında açılır.
 * - `tel:`, `mailto:` gibi şemalar ilgili sistem uygulamasına gider.
 * - Web sürümünde dış adresler yeni sekmede açılır.
 */
export async function openUrl(raw: string | null | undefined, options: OpenUrlOptions = {}): Promise<boolean> {
  const url = raw?.trim();
  if (!url) {
    return false;
  }

  if (!isHttpUrl(url) || Platform.OS === 'web') {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  }

  if (loadWebView()) {
    useInAppBrowserStore.getState().open(url, options.title);
    return true;
  }

  // Yerel derleme henüz WebView içermiyorsa sistemin uygulama içi tarayıcısı
  // (iOS'ta sayfa kartı, Android'de Custom Tabs) kullanılır.
  const webBrowser = loadWebBrowser();
  if (webBrowser) {
    try {
      await webBrowser.openBrowserAsync(url, {
        presentationStyle: webBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        dismissButtonStyle: 'close',
        enableBarCollapsing: true,
        showTitle: true,
      });
      return true;
    } catch {
      // Aşağıdaki son çareye düşer.
    }
  }

  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
