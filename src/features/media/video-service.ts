import { Platform } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { releaseTempFile } from './local-file';

/**
 * Video hazırlama yardımcıları.
 *
 * Ürün kuralı: süre sınırı yoktur ve hiçbir video dosya boyutundan dolayı
 * reddedilmez. Herkese açık içerik Cloudflare R2'ye yazıldığı için depo
 * tarafında da bir tavan yoktur; sıkıştırma yalnızca yükleme hızı ve bant
 * genişliği için yapılır.
 *
 * Akış:
 * 1. Video 1080p ve altındaysa, kalite bütçesinin içindeyse ve yeniden
 *    kodlama gerektirmiyorsa hiç dokunulmadan yüklenir — paylaşım anında
 *    başlar.
 * 2. Aksi halde tek geçişte çözünürlük ve kalite hedefine göre bit hızı
 *    seçilir. Süre uzadıkça bit hızı kademeli düşer: uzun videolar da mobil
 *    bağlantıda hızlı yüklenir, kalite kabul edilebilir kalır.
 * 3. Yalnızca dosya sınırı olan bir depoya yükleniyorsa (`targetBytes`) hedef
 *    boyuta göre bit hızı hesaplanır ve gerekirse bir düzeltme geçişi yapılır.
 *
 * Sıkıştırma native bir modül gerektirir (`react-native-compressor`). Modül
 * eski bir dev-client derlemesinde yoksa hazırlık sessizce orijinal dosyayla
 * devam eder ve `compressorUnavailable` ile bildirilir; yükleme yine yapılır.
 *
 * Hazırlık sonucu URI bazında önbelleklenir: kullanıcı videoyu seçtiği anda
 * arka planda başlatılır, "Paylaş"a bastığında iş genellikle bitmiş olur.
 */

export const VIDEO_LONG_SIDE = 1920;
/** Ses her zaman AAC 128 kbps. */
const AUDIO_BITRATE = 128_000;
/**
 * Kalite odaklı bit hızı: piksel başına bit (30 fps varsayımı). 1080p'de
 * ~5,6 Mbps; telefonda kaynaktan ayırt edilemeyecek düzey.
 */
const BITS_PER_PIXEL = 0.09;
const MAX_VIDEO_BITRATE = 8_000_000;
const MIN_VIDEO_BITRATE = 1_500_000;
/**
 * Sığdırma geçişlerinde inilebilecek en düşük bit hızı. Yalnızca `targetBytes`
 * verilen (depo sınırı olan) yüklemelerde kullanılır.
 */
const MIN_FIT_BITRATE = 60_000;
/**
 * Süreye göre bit hızı tavanı. Bit hızı süreden bağımsız seçilirse 20 dakikalık
 * bir video 1080p'de gigabaytlara çıkar ve mobil yükleme dakikalarca sürer.
 * Kademeli tavan hiçbir videoyu reddetmez; yalnızca paylaşım süresini makul
 * tutar. Kısa videolarda tavan devreye girmez, kalite korunur.
 */
const DURATION_BITRATE_CEILINGS: readonly (readonly [maxSeconds: number, bitrate: number])[] = [
  [60, 8_000_000],
  [300, 6_000_000],
  [900, 4_000_000],
  [3600, 2_500_000],
  [Number.POSITIVE_INFINITY, 1_500_000],
];

/** Süreye karşılık gelen bit hızı tavanı. */
function durationBitrateCeiling(durationMs: number | null | undefined): number {
  if (!durationMs || durationMs <= 0) {
    return MAX_VIDEO_BITRATE;
  }
  const seconds = durationMs / 1000;
  for (const [maxSeconds, bitrate] of DURATION_BITRATE_CEILINGS) {
    if (seconds <= maxSeconds) {
      return bitrate;
    }
  }
  return MIN_VIDEO_BITRATE;
}

type CompressorModule = typeof import('react-native-compressor');

type VideoThumbnailsModule = typeof import('expo-video-thumbnails');

let thumbnailsModule: VideoThumbnailsModule | null | undefined;

/**
 * Kapak üreticisini tembel ve güvenli biçimde yükler.
 *
 * `expo-video-thumbnails` modülü değerlendirilirken native modülü arar ve
 * derlemede yoksa **senkron** olarak fırlatır. Statik `import` bu hatayı bundle
 * değerlendirmesine taşır: modülü zincirleme içe aktaran her ekran (feed →
 * PostCard → VideoThumbnail) açılışta kırmızı ekranla düşer. Senkron `require`
 * fırlatmayı normal try/catch ile yakalanabilir kılar; modül yoksa kapak
 * üretimi atlanır ve uygulamanın geri kalanı çalışmaya devam eder.
 */
export function loadVideoThumbnails(): VideoThumbnailsModule | null {
  if (Platform.OS === 'web') {
    return null;
  }
  if (thumbnailsModule !== undefined) {
    return thumbnailsModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native modul yoksa statik import bundle'i cokertiyor
    thumbnailsModule = require('expo-video-thumbnails') as VideoThumbnailsModule;
  } catch {
    if (__DEV__) {
      console.warn(
        '[video-service] expo-video-thumbnails yuklenemedi; video kapaklari uretilmeyecek. Dev client derlemesi bu modulu icermiyor olabilir.',
      );
    }
    thumbnailsModule = null;
  }
  return thumbnailsModule;
}

let compressorPromise: Promise<CompressorModule | null> | null = null;

/**
 * Native sıkıştırıcıyı tembel ve güvenli biçimde yükler.
 *
 * Burada bilinçli olarak `require` kullanılır, `import()` değil. `import()`
 * Metro'da ayrı bir "split bundle" üretir; o parça yüklenemediğinde (bayat
 * Metro önbelleği, değişen modül kimlikleri) native tarafta hata `ErrorUtils`
 * üzerinden fatal olarak bildirilir ve promise'in `.catch`'i bunu **hiçbir
 * zaman** yakalayamaz — uygulama kırmızı ekranla durur. Senkron `require` ana
 * pakete girer; native modül bu derlemede yoksa fırlatılan bağlantı hatası
 * normal try/catch ile yakalanır ve video orijinal dosyayla yüklenir.
 */
export function loadVideoCompressor(): Promise<CompressorModule | null> {
  if (Platform.OS === 'web') {
    return Promise.resolve(null);
  }
  if (!compressorPromise) {
    compressorPromise = Promise.resolve()
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- split bundle fatal hatasini onlemek icin bilincli
      .then(() => require('react-native-compressor') as CompressorModule)
      .catch(() => {
        if (__DEV__) {
          // Sessiz dusus bilincli: paylasim bloklanmaz. Ancak gelistiricinin
          // "video neden sikistirilmadi" sorusunun cevabi burada gorunsun.
          console.warn(
            '[video-service] react-native-compressor yuklenemedi; videolar orijinal haliyle yuklenecek. Dev client derlemesi bu modulu icermiyor olabilir.',
          );
        }
        return null;
      });
  }
  return compressorPromise;
}

export type VideoSource = {
  uri: string;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
};

/**
 * Cihazdaki **bütün** ağır video işleri (kodlama ve kapak üretimi) tek sırada
 * çalışır.
 *
 * Neden: kapak üretimi de kodlama da native tarafta bir video decoder açar.
 * İkisi aynı anda başladığında Android'de MediaCodec bileşeni ayıramıyor
 * ("Failed to allocate component instance"), iOS'ta AVAssetReader/Writer
 * çakışıyor ve bellek tepesi ikiye katlanıyor. Bu durumda hata JS'e değil,
 * doğrudan native katmana düşüyor: uygulama kapanıyor. Sıraya almak toplam
 * süreyi yalnızca birkaç yüz milisaniye uzatır, karşılığında çökme riskini
 * ortadan kaldırır. Çoklu video seçiminde de encoder'ı kilitlenmekten korur.
 */
let nativeVideoChain: Promise<unknown> = Promise.resolve();

function runExclusiveNativeVideo<T>(work: () => Promise<T>): Promise<T> {
  const result = nativeVideoChain.then(work, work);
  nativeVideoChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Native bir promise hiç çözülmezse paylaşım sonsuza kadar beklemesin.
 *
 * iOS'ta `getVideoMetaData` video track'i olmayan bir dosyada `resolve` veya
 * `reject` çağırmıyor; promise sonsuza kadar askıda kalıyor ve "Paylaş"
 * düğmesi kalıcı olarak "hazırlanıyor" ekranında kilitleniyordu.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}-timeout`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(`${label}-failed`));
      },
    );
  });
}

/** Meta okuma kısa bir sürede bitmezse seçim anındaki bilgilerle devam edilir. */
const META_TIMEOUT_MS = 4_000;
/** Kapak üretimi bu sürede bitmezse kapaksız devam edilir. */
const POSTER_TIMEOUT_MS = 8_000;
/**
 * Kapağın uzun kenarı.
 *
 * Kapak; akış kartı, sohbet balonu ve paylaşım kartı (`og:image`) için
 * kullanılır. Native üretici kareyi videonun **tam** çözünürlüğünde veriyor
 * (ör. 2160x3840 → ~650 KB). WhatsApp/Telegram bağlantı önizlemesi ~300 KB
 * üstündeki görselleri yok saydığı için paylaşılan gönderide görsel
 * görünmüyordu. 1080 px uzun kenar her yerde net görünür ve ~150 KB kalır.
 */
const POSTER_MAX_SIDE = 1080;
/**
 * Kodlama ilerlemesi bu süre boyunca hiç gelmezse iş takılmış sayılır.
 *
 * MediaCodec/AVAssetWriter bazı bozuk kaynaklarda hatayı bildirmeden kilitlenir
 * ve promise asla sonuçlanmaz. Süre her ilerleme olayında sıfırlandığı için
 * uzun ama sağlıklı kodlamalar kesilmez.
 */
const ENCODE_STALL_MS = 90_000;

/**
 * Süren kodlamaların iptal kimlikleri: video URI'si → native cancellation id.
 * "İptal" düğmesi hem JS tarafındaki beklemeyi hem native encoder'ı durdurur.
 */
const activeEncodes = new Map<string, string>();

export type PreparedVideo = {
  uri: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  size: number | null;
  /** Yeniden kodlama yapıldı mı? */
  compressed: boolean;
  /** Native modül bu derlemede yoksa true; orijinal dosya döner. */
  compressorUnavailable: boolean;
  /**
   * Yalnızca `targetBytes` verilen yüklemelerde anlamlıdır: istenen boyutun
   * üzerinde kalındı mı? Herkese açık (R2) yüklemelerde her zaman false.
   */
  exceedsLimit: boolean;
};

export type VideoMeta = {
  size: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

type NativeVideoMeta = {
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
};

function positive(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeMeta(source: VideoSource, native?: NativeVideoMeta | null): VideoMeta {
  return {
    size: positive(native?.size) ?? positive(source.size),
    // `getVideoMetaData` süreyi saniye cinsinden döndürür.
    durationMs: positive(native?.duration)
      ? Math.round((native?.duration ?? 0) * 1000)
      : positive(source.durationMs),
    width: positive(native?.width) ?? positive(source.width),
    height: positive(native?.height) ?? positive(source.height),
  };
}

async function readNativeMeta(
  compressor: CompressorModule,
  uri: string,
): Promise<NativeVideoMeta | null> {
  try {
    return (await withTimeout(
      compressor.getVideoMetaData(uri) as Promise<NativeVideoMeta>,
      META_TIMEOUT_MS,
      'meta',
    )) as NativeVideoMeta;
  } catch {
    return null;
  }
}

/**
 * Görüntü kalitesinden bit hızı hesaplar. Dosya boyutu hedefi yoktur; süre
 * uzadıkça kademeli tavan devreye girer (bkz. `DURATION_BITRATE_CEILINGS`),
 * böylece uzun videolar mobil bağlantıda hızlı yüklenebilir.
 */
function bitrateFor(
  width: number | null,
  height: number | null,
  durationMs: number | null = null,
): number {
  const w = width ?? VIDEO_LONG_SIDE;
  const h = height ?? Math.round(VIDEO_LONG_SIDE * 0.5625);
  // 30 fps varsayımı: sabit kare hızında kalite/bit oranı dengeli kalır.
  const computed = w * h * 30 * BITS_PER_PIXEL + AUDIO_BITRATE;
  const ceiling = durationBitrateCeiling(durationMs);
  const bounded = Math.min(computed, ceiling);
  return Math.round(Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, bounded)));
}

/**
 * Depo tek dosya sınırına sığdırmak için gereken bit hızı. Süre bilinmiyorsa
 * `null` döner ve çağıran ölçülen boyuta göre düzeltme yapar.
 */
function fitBitrate(durationMs: number | null, targetBytes: number): number | null {
  if (!durationMs || durationMs <= 0) {
    return null;
  }
  const seconds = durationMs / 1000;
  // Kap (container) ve ses payı için %8 güvenlik marjı bırakılır.
  const budgetBits = targetBytes * 8 * 0.92;
  const computed = budgetBits / seconds - AUDIO_BITRATE;
  if (!Number.isFinite(computed)) {
    return null;
  }
  return Math.round(Math.max(MIN_FIT_BITRATE, computed));
}

/**
 * Sığdırma bit hızı çok düşükse 1080p kodlamak sadece bulanıklık üretir.
 * Bu yüzden bit hızına göre çözünürlük kademesi seçilir.
 */
function sideForBitrate(bitrate: number, maxSide: number): number {
  if (bitrate >= 2_400_000) {
    return maxSide;
  }
  if (bitrate >= 1_000_000) {
    return Math.min(maxSide, 1280);
  }
  return Math.min(maxSide, 854);
}

/** Yeniden kodlama sonrası hedef piksel boyutu. */
function scaledSize(
  width: number | null,
  height: number | null,
  maxLongSide: number,
): { width: number; height: number } | null {
  if (!width || !height) {
    return null;
  }
  const longSide = Math.max(width, height);
  if (longSide <= maxLongSide) {
    return { width, height };
  }
  const scale = maxLongSide / longSide;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export type PrepareVideoOptions = {
  /**
   * Yeniden kodlanacak en uzun kenar. `0` verilirse kaynak çözünürlük korunur.
   * Varsayılan 1080p.
   */
  maxLongSide?: number;
  /**
   * Verilirse kodlama bu bayt bütçesine sığdırılır. Yalnızca dosya sınırı olan
   * depolara (gizli sohbet medyası → Supabase Storage) yüklerken kullanılır.
   * Verilmezse video boyuttan bağımsız olarak yalnızca kalite/hız için kodlanır
   * ve hiçbir boyutta reddedilmez.
   */
  targetBytes?: number | null;
  /** 0..1 arası kodlama ilerlemesi. */
  onProgress?: (progress: number) => void;
  /**
   * İptal sinyali. Paylaşımdan vazgeçilirse süren kodlama durdurulur ve
   * orijinal dosya döner; yeni kodlama başlatılmaz.
   */
  signal?: AbortSignal;
};

type PreparedEntry = {
  promise: Promise<PreparedVideo>;
  ratio: number;
  listeners: Set<(ratio: number) => void>;
};

/**
 * Aynı video için kodlama yalnızca bir kez çalışır. Kullanıcı videoyu seçtiği
 * anda arka planda başlatılır; "Paylaş"a bastığında iş çoğunlukla bitmiş olur.
 * Sonuç, promise bazında paylaşılır; hazırlık sırasında eklenen dinleyiciler o
 * ana kadarki ilerlemeyi anında alır.
 */
const preparedCache = new Map<string, PreparedEntry>();
const PREPARED_CACHE_LIMIT = 4;

function preparedKey(uri: string, maxLongSide: number, targetBytes: number | null) {
  return `${uri}|${maxLongSide}|${targetBytes ?? 'free'}`;
}

function trimPreparedCache() {
  while (preparedCache.size > PREPARED_CACHE_LIMIT) {
    const oldest = preparedCache.keys().next();
    if (oldest.done) {
      return;
    }
    const evicted = preparedCache.get(oldest.value);
    preparedCache.delete(oldest.value);
    // Önbellekten düşen geçici dosya diskte kalmasın.
    void evicted?.promise
      .then((prepared) => (prepared.compressed ? releaseTempFile(prepared.uri) : undefined))
      .catch(() => undefined);
  }
}

/**
 * Videoyu paylaşıma hazırlar. Hiçbir video boyutundan dolayı reddedilmez:
 * herkese açık yüklemelerde depo tarafında tavan yoktur, sıkıştırma yalnızca
 * paylaşım hızı ve bant genişliği içindir. 1080p'nin üzerindeki kaynaklar da
 * 1080p'ye çekilir. Süre sınırı yoktur. `targetBytes` yalnızca sınırlı depolara
 * yüklerken verilir. Hata durumunda orijinal dosya döner. Aynı parametrelerle
 * ikinci çağrı yeni bir kodlama başlatmaz.
 */
export function prepareVideoForUpload(
  source: VideoSource,
  options: PrepareVideoOptions = {},
): Promise<PreparedVideo> {
  const maxLongSide = options.maxLongSide ?? VIDEO_LONG_SIDE;
  const targetBytes =
    options.targetBytes && options.targetBytes > 0 ? Math.floor(options.targetBytes) : null;
  const key = preparedKey(source.uri, maxLongSide, targetBytes);
  let entry = preparedCache.get(key);

  // Vazgeçilmiş bir istek için yeni kodlama başlatılmaz: kullanıcı zaten
  // paylaşımdan dönmüş, cihazı yormak gereksiz.
  if (!entry && options.signal?.aborted) {
    return Promise.resolve({
      uri: source.uri,
      ...normalizeMeta(source),
      compressed: false,
      compressorUnavailable: false,
      exceedsLimit: false,
    });
  }

  if (!entry) {
    const created: PreparedEntry = {
      promise: Promise.resolve({
        uri: source.uri,
        ...normalizeMeta(source),
        compressed: false,
        compressorUnavailable: false,
        exceedsLimit: false,
      }),
      ratio: 0,
      listeners: new Set(),
    };
    created.promise = runPrepare(
      source,
      maxLongSide,
      targetBytes,
      (ratio) => {
        created.ratio = ratio;
        created.listeners.forEach((listener) => listener(ratio));
      },
      options.signal,
    ).then((prepared) => {
      created.ratio = 1;
      created.listeners.forEach((listener) => listener(1));
      return prepared;
    });
    entry = created;
    preparedCache.set(key, created);
    trimPreparedCache();
  }

  const listener = options.onProgress;
  if (listener) {
    // Dinleyici geç katıldıysa mevcut ilerlemeyi hemen alsın.
    listener(entry.ratio);
    entry.listeners.add(listener);
    const target = entry;
    void target.promise
      .catch(() => undefined)
      .then(() => {
        target.listeners.delete(listener);
      });
  }

  // İptal sinyali, süren native kodlamayı da durdurur. Aksi halde kullanıcı
  // vazgeçse bile encoder çalışmaya devam ediyordu.
  const signal = options.signal;
  if (signal) {
    const onAbort = () => cancelVideoPreparation(source.uri);
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
      const current = entry;
      void current.promise
        .catch(() => undefined)
        .then(() => {
          signal.removeEventListener('abort', onAbort);
        });
    }
  }

  return entry.promise;
}

/** Hazırlık ilerlemesi (0..1); UI'da "hazır" etiketi için kullanılır. */
export function videoPreparationRatio(
  uri: string,
  maxLongSide = VIDEO_LONG_SIDE,
  targetBytes: number | null = null,
): number {
  return preparedCache.get(preparedKey(uri, maxLongSide, targetBytes))?.ratio ?? 0;
}

async function runPrepare(
  source: VideoSource,
  maxLongSide: number,
  targetBytes: number | null,
  report: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<PreparedVideo> {
  const meta = normalizeMeta(source);
  try {
    return await encodeForUpload(source, maxLongSide, targetBytes, report, signal);
  } catch {
    // Beklenmeyen bir hata paylaşımı engellemesin: orijinal dosya yüklenir.
    return {
      uri: source.uri,
      ...meta,
      compressed: false,
      compressorUnavailable: false,
      exceedsLimit: targetBytes !== null && (meta.size ?? 0) > targetBytes,
    };
  }
}

/**
 * Tek bir videoyu yeniden kodlar.
 *
 * Sarmalayıcının üç görevi var:
 * 1. İlerleme akmaya devam ettiği sürece dokunmamak, tamamen durduğunda
 *    (native kilitlenme) işi iptal edip orijinal dosyayla devam etmek.
 * 2. Native iptal kimliğini kaydetmek; "İptal" düğmesi gerçek encoder'ı
 *    durdurabilsin.
 * 3. Sözü her koşulda sonuçlandırmak. Sıradaki videoların (ve "Paylaş"
 *    düğmesinin) sonsuza kadar beklememesi buna bağlı.
 */
function compressWithStallGuard(
  compressor: CompressorModule,
  uri: string,
  bitrate: number,
  maxSize: number,
  report: (ratio: number) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let cancellationId: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      activeEncodes.delete(uri);
    };

    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clear();
      fn();
    };

    const arm = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        // Takılan native işi serbest bırak: aksi halde encoder açık kalır ve
        // sonraki videolar onun arkasında bekler.
        stopNativeCompression(compressor, cancellationId);
        settle(() => reject(new Error('encode-stalled')));
      }, ENCODE_STALL_MS);
    };

    arm();

    try {
      compressor.Video.compress(
        uri,
        {
          compressionMethod: 'manual',
          maxSize,
          bitrate,
          // Süre sınırı yok: her video, uzunluğu ne olursa olsun işlenir.
          minimumFileSizeForCompress: 0,
          progressDivider: 4,
          getCancellationId: (id) => {
            cancellationId = id;
            activeEncodes.set(uri, id);
          },
        },
        (progress) => {
          arm();
          report(Math.max(0, Math.min(progress, 1)));
        },
      ).then(
        (output) => settle(() => resolve(output)),
        (error: unknown) => settle(() => reject(error)),
      );
    } catch (error) {
      settle(() => reject(error));
    }
  });
}

function stopNativeCompression(compressor: CompressorModule, cancellationId: string | null) {
  if (!cancellationId) {
    return;
  }
  try {
    compressor.Video.cancelCompression(cancellationId);
  } catch {
    // Native iptal desteklenmiyorsa JS tarafı yine de bırakır.
  }
}

/**
 * Süren video hazırlığını iptal eder.
 *
 * Kullanıcı paylaşımdan vazgeçtiğinde çağrılır: native encoder durur, geçici
 * çıktı dosyası salınır ve önbellek temizlenir. Böylece iptal edilen video
 * arka planda çalışmaya devam edip cihazı yormaz.
 */
export function cancelVideoPreparation(uri: string): void {
  const cancellationId = activeEncodes.get(uri) ?? null;
  activeEncodes.delete(uri);

  // Bu URI'ye ait önbellek kayıtları düşürülür ki yeniden denendiğinde iş
  // baştan ve temiz biçimde başlasın.
  const prefix = `${uri}|`;
  for (const key of Array.from(preparedCache.keys())) {
    if (key.startsWith(prefix)) {
      preparedCache.delete(key);
    }
  }

  if (!cancellationId) {
    return;
  }
  void loadVideoCompressor().then((compressor) => {
    if (compressor) {
      stopNativeCompression(compressor, cancellationId);
    }
  });
}

async function encodeForUpload(
  source: VideoSource,
  maxLongSide: number,
  targetBytes: number | null,
  report: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<PreparedVideo> {
  const compressor = await loadVideoCompressor();
  const sourceMeta = normalizeMeta(source);
  if (!compressor) {
    return {
      uri: source.uri,
      ...sourceMeta,
      compressed: false,
      compressorUnavailable: true,
      exceedsLimit: targetBytes !== null && (sourceMeta.size ?? 0) > targetBytes,
    };
  }

  const native = await readNativeMeta(compressor, source.uri);
  const meta = normalizeMeta(source, native);
  const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
  const needsResize = maxLongSide > 0 && longSide > maxLongSide;

  const output = scaledSize(meta.width, meta.height, maxLongSide);
  const qualityBitrate = bitrateFor(output?.width ?? null, output?.height ?? null, meta.durationMs);
  const durationSeconds = meta.durationMs ? meta.durationMs / 1000 : null;
  // Kaynağın gerçek bit hızı: kalite hedefinin belirgin üzerindeyse yeniden
  // kodlamak yükleme süresini kısaltır ve görünür kalite kaybı yaratmaz.
  const sourceBitrate =
    meta.size !== null && durationSeconds !== null ? (meta.size * 8) / durationSeconds : null;
  const wasteful = sourceBitrate !== null && sourceBitrate > qualityBitrate * 1.1;
  // Depo sınırı yalnızca `targetBytes` verildiğinde devreye girer.
  const fitsStorage =
    targetBytes === null || (meta.size !== null && meta.size <= targetBytes);

  // 1080p ve altı, kalite bütçesinde kalan ve sınırı aşmayan kaynaklar olduğu
  // gibi yüklenir: bekleme yok.
  if (!needsResize && !wasteful && fitsStorage) {
    report(1);
    return {
      uri: source.uri,
      ...meta,
      compressed: false,
      compressorUnavailable: false,
      exceedsLimit: false,
    };
  }

  const encode = async (
    bitrate: number,
    maxSize: number,
  ): Promise<PreparedVideo | null> => {
    // Sırada beklerken vazgeçilmiş olabilir: boşuna kodlama başlatma.
    if (signal?.aborted) {
      return null;
    }
    try {
      const uri = await runExclusiveNativeVideo(() =>
        compressWithStallGuard(compressor, source.uri, bitrate, maxSize, report),
      );
      const encodedNative = await readNativeMeta(compressor, uri);
      return {
        uri,
        ...normalizeMeta({ uri, ...meta }, encodedNative),
        compressed: true,
        compressorUnavailable: false,
        exceedsLimit: false,
      };
    } catch {
      return null;
    }
  };

  // İlk geçiş: depo sınırı varsa hedefe göre, yoksa yalnızca kalite hedefine
  // göre kodlanır. Bit hızı çok düşecekse çözünürlük de düşürülür (aşırı
  // bulanıklığı önlemek için); herkese açık yüklemelerde 1080p korunur.
  const fitted = targetBytes !== null ? fitBitrate(meta.durationMs, targetBytes) : null;
  const firstBitrate = fitted !== null ? Math.min(fitted, qualityBitrate) : qualityBitrate;
  let firstSide = maxLongSide;
  if (fitted !== null) {
    firstSide = Math.min(maxLongSide, sideForBitrate(fitted, maxLongSide));
  }

  let result = await encode(firstBitrate, firstSide);
  if (!result) {
    return {
      uri: source.uri,
      ...meta,
      compressed: false,
      compressorUnavailable: false,
      exceedsLimit: targetBytes !== null && (meta.size ?? 0) > targetBytes,
    };
  }

  // Depo sınırı varsa ve tahmin tutmazsa düzeltme geçişleri yapılır. Boyut
  // hedefi olmayan yüklemelerde ikinci kodlama yalnızca zaman kaybıdır; tek
  // geçişte bitirilir.
  const target = targetBytes;
  let pass = 0;
  let currentBitrate = firstBitrate;
  let currentSide = firstSide;
  while (target !== null && (result.size ?? 0) > target && pass < 2) {
    pass += 1;
    const measured = result.size ?? 0;
    if (measured <= 0) {
      break;
    }
    const duration = result.durationMs ?? meta.durationMs;
    const needed =
      duration && duration > 0
        ? Math.round(((target * 8 * 0.92) / (duration / 1000)) - AUDIO_BITRATE)
        : Math.round(currentBitrate * 0.6);
    const nextBitrate = Math.max(MIN_FIT_BITRATE, Math.min(currentBitrate - 1, needed));
    if (nextBitrate <= 0 || nextBitrate >= currentBitrate) {
      // Hedef bit hızı tabanın altında: daha fazla denemek aynı sonucu verir.
      break;
    }
    const nextSide = Math.min(currentSide, sideForBitrate(nextBitrate, maxLongSide));
    const retried = await encode(nextBitrate, nextSide);
    if (!retried) {
      break;
    }
    const grown = (retried.size ?? 0) >= measured;
    result = retried;
    currentBitrate = nextBitrate;
    currentSide = nextSide;
    if (grown) {
      // Boyut küçülmüyorsa daha fazla geçiş zaman kaybıdır.
      break;
    }
  }

  report(1);
  return {
    ...result,
    exceedsLimit: target !== null && (result.size ?? 0) > target,
  };
}

const posterCache = new Map<string, string>();

/**
 * Daha önce üretilmiş kapak varsa senkron olarak döner. İyimser (henüz
 * yüklenmemiş) video balonunun beklemeden kapak göstermesini sağlar.
 */
export function cachedVideoPoster(uri: string, timeMs = 400): string | null {
  return posterCache.get(`${uri}#${timeMs}`) ?? null;
}

/**
 * Web'de kapak üretimi: `<video>` ilk karesi tuvale çizilip JPEG'e çevrilir.
 *
 * `expo-video-thumbnails` web'de native modül olmadığı için `null` dönüyordu ve
 * paylaşım ekranında video kutusu boş görünüyordu. R2 medyası
 * `Access-Control-Allow-Origin: *` gönderdiği için tuval kirlenmez; tarayıcı
 * dosyası (`blob:`) ve uzak adresler aynı yolla çalışır.
 */
async function webVideoPoster(uri: string, timeMs: number): Promise<PosterResult | null> {
  if (typeof document === 'undefined') {
    return null;
  }
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = uri;

  const release = () => {
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      // Yoksay: zaten boşaltılmış bir öğe.
    }
  };

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('poster-load-failed'));
      }),
      POSTER_TIMEOUT_MS,
      'poster-web',
    );

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const wanted = Math.max(0, Math.min(timeMs, 1000)) / 1000;
    const target = duration > 0.1 ? Math.min(wanted, duration * 0.5, duration - 0.05) : 0;
    if (target > 0.02) {
      try {
        await withTimeout(
          new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve();
            video.onerror = () => reject(new Error('poster-seek-failed'));
            video.currentTime = target;
          }),
          POSTER_TIMEOUT_MS,
          'poster-seek',
        );
      } catch {
        // Arama başarısızsa yüklenen ilk kare kullanılır.
      }
    }

    const sourceWidth = video.videoWidth || 720;
    const sourceHeight = video.videoHeight || 1280;
    const scale = Math.min(1, POSTER_MAX_SIDE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.drawImage(video, 0, 0, width, height);
    return { uri: canvas.toDataURL('image/jpeg', 0.72), width, height };
  } catch {
    return null;
  } finally {
    release();
  }
}

/**
 * Kapağı `POSTER_MAX_SIDE` ile sınırlar. Native üretici tam çözünürlük verdiği
 * için hem akışta bellek hem paylaşım kartında dosya boyutu bundan etkilenir.
 */
async function shrinkPoster(poster: PosterResult): Promise<PosterResult> {
  const { uri, width, height } = poster;
  // Boyut bilinmiyorsa ölçekleme yapılmaz: yanlış yönde büyütmek dosyayı
  // küçültmek yerine büyütür.
  if (!width || !height || Math.max(width, height) <= POSTER_MAX_SIDE) {
    return poster;
  }
  try {
    const context = ImageManipulator.manipulate(uri);
    context.resize(width >= height ? { width: POSTER_MAX_SIDE } : { height: POSTER_MAX_SIDE });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return {
      uri: saved.uri,
      width: positive(saved.width) ?? width,
      height: positive(saved.height) ?? height,
    };
  } catch {
    return poster;
  }
}

type PosterResult = { uri: string; width: number | null; height: number | null };

/**
 * Video için yerel bir kapak (ilk kare) üretir. Sonuç ekranlar arasında
 * paylaşılan bir bellek önbelleğinde tutulur; aynı video için tekrar
 * üretilmez.
 */
export async function generateVideoPoster(
  uri: string,
  timeMs = 400,
): Promise<PosterResult | null> {
  const key = `${uri}#${timeMs}`;
  const cached = posterCache.get(key);
  if (cached) {
    return { uri: cached, width: null, height: null };
  }
  if (Platform.OS === 'web') {
    const web = await webVideoPoster(uri, timeMs);
    if (!web) {
      return null;
    }
    posterCache.set(key, web.uri);
    return web;
  }
  const thumbnails = loadVideoThumbnails();
  if (!thumbnails) {
    return null;
  }
  try {
    const thumbnail = await runExclusiveNativeVideo(() =>
      withTimeout(
        thumbnails.getThumbnailAsync(uri, {
          time: Math.max(0, Math.min(timeMs, 1000)),
          quality: 0.72,
        }),
        POSTER_TIMEOUT_MS,
        'poster',
      ),
    );
    const sized = await shrinkPoster({
      uri: thumbnail.uri,
      width: positive(thumbnail.width),
      height: positive(thumbnail.height),
    });
    posterCache.set(key, sized.uri);
    return sized;
  } catch {
    return null;
  }
}

/** 1:05 / 1:02:03 biçiminde süre etiketi. */
export function formatVideoDuration(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) {
    return null;
  }
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 980 B / 12,4 MB biçiminde dosya boyutu. */
export function formatVideoSize(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) {
    return null;
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(mb >= 10 ? 0 : 1).replace('.', ',')} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
