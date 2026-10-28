import { useEffect, useState, type PropsWithChildren } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  type EdgeInsets,
} from 'react-native-safe-area-context';

const ZERO: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * CSS `env(safe-area-inset-*)` değerlerini gizli bir ölçüm kutusuyla okur.
 *
 * Değerler doğrudan tarayıcıdan gelir; sayfanın kaydırma konumundan etkilenmez.
 */
function readEnvInsets(): EdgeInsets {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return ZERO;
  }
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.top = '0';
  probe.style.left = '0';
  probe.style.width = '0';
  probe.style.height = '0';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.paddingTop = 'env(safe-area-inset-top)';
  probe.style.paddingBottom = 'env(safe-area-inset-bottom)';
  probe.style.paddingLeft = 'env(safe-area-inset-left)';
  probe.style.paddingRight = 'env(safe-area-inset-right)';
  document.body.appendChild(probe);

  const computed = window.getComputedStyle(probe);
  const read = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
  };
  const insets: EdgeInsets = {
    top: read(computed.paddingTop),
    bottom: read(computed.paddingBottom),
    left: read(computed.paddingLeft),
    right: read(computed.paddingRight),
  };
  probe.remove();
  return insets;
}

/**
 * Web'de güvenli alan değerlerini düzeltir.
 *
 * `react-native-safe-area-context` web sağlayıcısı inset'leri kendi kök
 * görünümünün `getBoundingClientRect()` değerinden hesaplıyor. Sayfa pencere
 * (document) kaydırmasıyla kaydırıldığında bu kök görünümün üst kenarı eksiye
 * düşüyor ve sağlayıcı bunu çentik payı sanıp `insets.top` değerini kaydırma
 * miktarı kadar (ör. 900) bildiriyor.
 *
 * Bu durumda yapışkan başlık (`WebHeader`) yüzlerce piksel üst boşluk alıp
 * ekranı kaplayan siyah bir karta dönüşüyordu. Mobil tarayıcılarda adres
 * çubuğu gizlenip görünürken `resize` tetiklendiği için hata tam da sayfa
 * kaydırılırken ortaya çıkıyordu.
 *
 * Değerler yalnızca `env()` üzerinden okunduğu için kaydırma konumundan
 * bağımsızdır. Native tarafta hiçbir şey değişmez.
 */
export function WebSafeAreaGuard({ children }: PropsWithChildren) {
  const { width, height } = useWindowDimensions();
  const [insets, setInsets] = useState<EdgeInsets>(ZERO);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    const update = () => setInsets(readEnvInsets());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.addEventListener('pageshow', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('pageshow', update);
    };
  }, []);

  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  const frame = { x: 0, y: 0, width, height };

  return (
    <SafeAreaInsetsContext.Provider value={insets}>
      <SafeAreaFrameContext.Provider value={frame}>{children}</SafeAreaFrameContext.Provider>
    </SafeAreaInsetsContext.Provider>
  );
}
