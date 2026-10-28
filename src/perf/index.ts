import { Platform } from 'react-native';

/**
 * Android hızlandırma ayarları.
 *
 * Tüm uygulama bu dosyadaki değerleri kullanır; böylece "Android'de daha hızlı
 * hissettir" kararı tek yerden verilir ve ekranlar arasında tutarlı kalır.
 * Android'de süreler kısalır, gereksiz görsel geçişler azalır; iOS tasarım dili
 * aynen korunur.
 */
export const isAndroid = Platform.OS === 'android';

export const perf = {
  /** Yığın geçişi: Android'de daha kısa; geri tuşu/geri kaydırma anında yanıt verir. */
  screenTransitionMs: isAndroid ? 150 : 180,

  /**
   * Açılış marka introsu. Android'de daha kısa tutulur: kullanıcı uygulamayı
   * daha erken kullanmaya başlar, aynı marka hissi korunur.
   */
  splashIntroMs: isAndroid ? 300 : 420,
  splashExitMs: isAndroid ? 120 : 150,

  /**
   * Medya geçişi. `skipOnCacheHit: 'all'` sayesinde cache'ten gelen görseller
   * cross-fade beklemeden çizilir; hızlı kaydırmada kare atlaması azalır.
   */
  imageTransition: {
    duration: isAndroid ? 90 : 140,
    skipOnCacheHit: 'all' as const,
  },

  /**
   * Reels oynatıcı tamponu (yalnızca Android). ExoPlayer varsayılan olarak 20
   * saniyelik ileri tampon ayırır; arka arkaya açılan oynatıcılarda bu bellek
   * ve bant genişliği israfıdır. Kısa Reels videoları için 4 saniye + 16 MB
   * sınır yeterlidir, ilk kare daha hızlı gelir.
   */
  reelBuffer: isAndroid
    ? ({ preferredForwardBufferDuration: 4, maxBufferBytes: 16 * 1024 * 1024 } as const)
    : null,
} as const;
