import { useEffect } from 'react';
import { Platform } from 'react-native';

const STYLE_ID = 'tz-web-scroll-fix';

/**
 * Web'de sayfa (document) kaydırmasını açar.
 *
 * Expo'nun web şablonu `body { overflow: hidden }` yazar. Bu kural, içerik
 * ekran yüksekliğini aştığında kaydırmayı tamamen kapatıyordu: fare tekerleği
 * sayfa gövdesine denk geldiğinde hiçbir şey olmuyor, klavye (PageDown/Boşluk)
 * ve tarayıcı kaydırma çubuğu çalışmıyordu.
 *
 * Uygulama ekranları kendi iç kaydırma alanlarını kullanmaya devam eder; bu
 * kural yalnızca taşan içeriğin pencere kaydırmasına düşmesini sağlar.
 */
export function useWebScrollFix() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }

    /*
     * Mobil tarayıcılarda adres çubuğu gizlenip görünürken CSS'in yükseklik
     * birimleri (`100vh`, hatta `100dvh`) her zaman görünen alanı birebir
     * izlemiyor. Kabuk görünür alandan kısa kaldığında alt sekme çubuğu
     * ekranın altına değil, ortasına yakın bir yere oturuyordu
     * ("tab menü çok yukarıda kalıyor").
     *
     * Bu yüzden görünen yüksekliği JS ile ölçüp `#root` için alt sınır olarak
     * yazıyoruz. `min-height` kullanılıyor: uzun tanıtım/hukuk sayfalarında
     * belge kaydırması bozulmadan devam eder, kabuk ise asla görünür alandan
     * kısa kalmaz.
     */
    let lastHeight = 0;

    const measure = () => {
      if (typeof window === 'undefined') {
        return;
      }
      const viewport = window.visualViewport;
      // Görünen alanı en doğru tarif eden ölçü `visualViewport`; desteklemeyen
      // tarayıcılarda pencere yüksekliğine düşülür.
      const height =
        (viewport?.height && viewport.height > 0 ? viewport.height : 0) ||
        window.innerHeight ||
        document.documentElement.clientHeight ||
        0;
      const rounded = Math.round(height);
      if (rounded > 0 && Math.abs(rounded - lastHeight) >= 1) {
        lastHeight = rounded;
        document.documentElement.style.setProperty('--tz-app-height', `${rounded}px`);
      }
    };

    measure();

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
      body { overflow-x: hidden; overflow-y: auto; }
      /*
       * Mobil tarayicilarda adres cubugu gizlenip gorunurken 100% degeri
       * "buyuk" görunur alani koruyor; alt sekme cubugu ekranin altinda
       * kalmiyor ve havada duruyormus gibi gorunuyordu. dvh, o an gorunen
       * yuksekligi izler; desteklenmeyen tarayicilar 100% ile devam eder.
       */
      @supports (height: 100dvh) {
        html, body { height: 100dvh; }
      }
      #root { min-height: var(--tz-app-height, 100%); }
    `;
      document.head.appendChild(style);
    }

    /*
     * Kaydırma sırasında `scroll` saniyede ~60 kez tetikleniyor. Ölçüm görünür
     * alan yüksekliğini okuduğu için her olayda düzen (layout) sorgusu yapmak
     * uzun sayfalarda kaydırmayı titretiyordu. Ölçüm kare başına en fazla bir
     * kez çalışır ve yükseklik gerçekten değişmediyse DOM'a yazmaz.
     */
    let frame = 0;
    const scheduleMeasure = () => {
      if (typeof requestAnimationFrame !== 'function') {
        measure();
        return;
      }
      if (frame) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    const visualViewport = window.visualViewport;
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('orientationchange', scheduleMeasure);
    visualViewport?.addEventListener('resize', scheduleMeasure);
    // Adres çubuğu kaydırma sırasında gizlenip açıldığında `resize` her tarayıcıda
    // tetiklenmiyor; kaydırma sonunda bir kez daha ölçmek boşluğu kapatıyor.
    window.addEventListener('scroll', scheduleMeasure, { passive: true });

    return () => {
      if (frame && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame);
      }
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('orientationchange', scheduleMeasure);
      visualViewport?.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', scheduleMeasure);
    };
  }, []);
}
