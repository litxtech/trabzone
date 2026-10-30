import type { ComponentType, Ref } from 'react';
import { Platform, TurboModuleRegistry } from 'react-native';
import type { WebView, WebViewProps } from 'react-native-webview';

export type WebViewHandle = WebView;
export type WebViewComponent = ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;
type WebBrowserModule = typeof import('expo-web-browser');

let webViewComponent: WebViewComponent | null | undefined;
let webBrowserModule: WebBrowserModule | null | undefined;

/**
 * `react-native-webview` içe aktarılırken yerel modülü zorunlu ister; modül
 * yerel derlemede yoksa uygulama açılışta çöker. Bu yüzden önce kayıt
 * kontrol edilir, paket ancak yerel taraf hazırsa yüklenir.
 */
export function loadWebView(): WebViewComponent | null {
  if (webViewComponent !== undefined) {
    return webViewComponent;
  }
  if (Platform.OS === 'web' || !TurboModuleRegistry.get('RNCWebViewModule')) {
    webViewComponent = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    webViewComponent = (require('react-native-webview') as { WebView: WebViewComponent }).WebView;
  } catch {
    webViewComponent = null;
  }
  return webViewComponent;
}

export function loadWebBrowser(): WebBrowserModule | null {
  if (webBrowserModule !== undefined) {
    return webBrowserModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    webBrowserModule = require('expo-web-browser') as WebBrowserModule;
  } catch {
    webBrowserModule = null;
  }
  return webBrowserModule;
}
