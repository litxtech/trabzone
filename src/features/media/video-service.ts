import { Platform } from 'react-native';

import { env } from '@/config/env';

import { releaseTempFile } from './local-file';

/**
 * Video hazırlama yardımcıları.
 *
 * Ürün kuralı: süre sınırı yoktur ve hiçbir video boyutundan dolayı
 * reddedilmez. Kullanıcı kaç MB olursa olsun bir video seçebilir; video
 * paylaşılmadan önce cihazda depo sınırının altına sıkıştırılır.
 *
 * Akış:
 * 1. Videoya hiç dokunmadan sığıyorsa (1080p ve altı, sınırın altında)
 *    doğrudan yüklenir — paylaşım anında başlar.
 * 2. Sığmıyorsa tek geçişte hedef boyuta göre bit hızı seçilir. Bit hızı çok
 *    düşecekse çözünürlük de kademeli düşürülür; amaç kabul edilebilir kalite.
 * 3. Tahmin tutmazsa en fazla bir düzeltme geçişi yapılır.
 *
 * Sıkıştırma native bir modül gerektirir (`react-native-compressor`). Modül
 * eski bir dev-client derlemesinde yoksa hazırlık sessizce orijinal dosyayla
 * devam eder ve `exceedsLimit` ile bildirilir; yükleme katmanı R2'ye düşer.
 *
 * Hazırlık sonucu URI bazında önbelleklenir: kullanıcı videoyu seçtiği anda
 * arka planda başlatılır, "Paylaş"a bastığında iş genellikle bitmiş olur.
 */

export const VIDEO_LONG_SIDE = 1920;
/**
 * Depo tarafındaki tek dosya sınırı. Ürün tarafında sınır yoktur: bu değer
 * yalnızca videonun hangi boyuta sıkıştırılacağını belirler.
 */
export const VIDEO_UPLOAD_LIMIT = env.maxUploadBytes;
/** Sıkıştırma hedefi: kap/paket payı için %6 boşluk bırakılır. */
export const VIDEO_UPLOAD_TARGET = Math.floor(VIDEO_UPLOAD_LIMIT * 0.94);
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
 * Sığdırma geçişlerinde inilebilecek en düşük bit hızı. Depo sınırı sabit
 * olduğu için çok uzun videolarda kalite ister istemez düşer; sınır burada
 * reddetmek değil, kodlayıcının kabul ettiği en düşük değerde durmaktır.
 */
const MIN_FIT_BITRATE = 60_000;

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
 * Video kodlaması cihazda tek sırada çalışır. Çoklu video seçiminde aynı anda
 * birkaç 1080p kodlama başlatmak encoder'ı kilitler, cihazı ısıtır ve toplam
 * süreyi uzatır; sıralı çalışmada ilk video çok daha erken hazır olur.
 */
let encodeChain: Promise<unknown> = Promise.resolve();

function runExclusiveEncode<T>(work: () => Promise<T>): Promise<T> {
  const result = encodeChain.then(work, work);
  encodeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

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
   * Tüm sıkıştırma geçişlerine rağmen dosya hâlâ depo sınırının üzerinde mi?
   * Bu durumda çağıran katman R2'ye yükler ya da son çare hatayı gösterir.
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
    return (await compressor.getVideoMetaData(uri)) as NativeVideoMeta;
  } catch {
    return null;
  }
}

/**
 * Görüntü kalitesinden bit hızı hesaplar. Sabit bir dosya boyutu hedefi
 * olmadığı için süre uzadıkça kalite düşmez; yalnızca çok yüksek bit hızları
 * kodlayıcıyı zorlamasın diye üstten sınırlanır.
 */
function bitrateFor(width: number | null, height: number | null): number {
  const w = width ?? VIDEO_LONG_SIDE;
  const h = height ?? Math.round(VIDEO_LONG_SIDE * 0.5625);
  // 30 fps varsayımı: sabit kare hızında kalite/bit oranı dengeli kalır.
  const computed = w * h * 30 * BITS_PER_PIXEL + AUDIO_BITRATE;
  return Math.round(Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, computed)));
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
  /** 0..1 arası kodlama ilerlemesi. */
  onProgress?: (progress: number) => void;
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

function preparedKey(uri: string, maxLongSide: number) {
  return `${uri}|${maxLongSide}`;
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
 * Videoyu paylaşıma hazırlar. Hangi boyutta olursa olsun video reddedilmez:
 * depo sınırının üzerindeki dosyalar cihazda sıkıştırılarak sınıra indirilir.
 * 1080p'nin üzerindeki kaynaklar da 1080p'ye çekilir. Süre sınırı yoktur.
 * Hata durumunda orijinal dosya döner ve `exceedsLimit` ile bildirilir. Aynı
 * parametrelerle ikinci çağrı yeni bir kodlama başlatmaz.
 */
export function prepareVideoForUpload(
  source: VideoSource,
  options: PrepareVideoOptions = {},
): Promise<PreparedVideo> {
  const maxLongSide = options.maxLongSide ?? VIDEO_LONG_SIDE;
  const key = preparedKey(source.uri, maxLongSide);
  let entry = preparedCache.get(key);

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
    created.promise = runPrepare(source, maxLongSide, (ratio) => {
      created.ratio = ratio;
      created.listeners.forEach((listener) => listener(ratio));
    }).then((prepared) => {
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

  return entry.promise;
}

/** Hazırlık ilerlemesi (0..1); UI'da "hazır" etiketi için kullanılır. */
export function videoPreparationRatio(uri: string, maxLongSide = VIDEO_LONG_SIDE): number {
  return preparedCache.get(preparedKey(uri, maxLongSide))?.ratio ?? 0;
}

async function runPrepare(
  source: VideoSource,
  maxLongSide: number,
  report: (ratio: number) => void,
): Promise<PreparedVideo> {
  const meta = normalizeMeta(source);
  try {
    return await encodeForUpload(source, maxLongSide, report);
  } catch {
    // Beklenmeyen bir hata paylaşımı engellemesin: orijinal dosya yüklenir.
    return {
      uri: source.uri,
      ...meta,
      compressed: false,
      compressorUnavailable: false,
      exceedsLimit: (meta.size ?? 0) > VIDEO_UPLOAD_LIMIT,
    };
  }
}

async function encodeForUpload(
  source: VideoSource,
  maxLongSide: number,
  report: (ratio: number) => void,
): Promise<PreparedVideo> {
  const compressor = await loadVideoCompressor();
  const sourceMeta = normalizeMeta(source);
  if (!compressor) {
    return {
      uri: source.uri,
      ...sourceMeta,
      compressed: false,
      compressorUnavailable: true,
      exceedsLimit: (sourceMeta.size ?? 0) > VIDEO_UPLOAD_LIMIT,
    };
  }

  const native = await readNativeMeta(compressor, source.uri);
  const meta = normalizeMeta(source, native);
  const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
  const needsResize = maxLongSide > 0 && longSide > maxLongSide;

  const output = scaledSize(meta.width, meta.height, maxLongSide);
  const qualityBitrate = bitrateFor(output?.width ?? null, output?.height ?? null);
  const target = VIDEO_UPLOAD_TARGET;
  const durationSeconds = meta.durationMs ? meta.durationMs / 1000 : null;
  // Kaynak hedefe sığıyor mu? Boyut bilinmiyorsa süre ve bit hızından tahmin.
  const exceedsTarget =
    meta.size !== null
      ? meta.size > target
      : durationSeconds !== null
        ? ((qualityBitrate + AUDIO_BITRATE) * durationSeconds) / 8 > target
        : false;

  // 1080p ve altı, hedefe sığan kaynaklar olduğu gibi yüklenir: bekleme yok.
  if (!needsResize && !exceedsTarget) {
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
    try {
      const uri = await runExclusiveEncode(() =>
        compressor.Video.compress(
          source.uri,
          {
            compressionMethod: 'manual',
            maxSize,
            bitrate,
            // Süre sınırı yok: her video, uzunluğu ne olursa olsun işlenir.
            minimumFileSizeForCompress: 0,
            progressDivider: 4,
          },
          (progress) => report(Math.max(0, Math.min(progress, 1))),
        ),
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

  // İlk geçiş: sığacaksa kalite odaklı, sığmayacaksa doğrudan hedefe göre
  // sıkıştır. Bit hızı düşükse çözünürlük de düşürülür (aşırı bulanıklığı
  // önlemek için). Hedef her durumda depo sınırının altıdır.
  const fitted = exceedsTarget ? fitBitrate(meta.durationMs, target) : null;
  const firstBitrate = fitted !== null ? Math.min(fitted, qualityBitrate) : qualityBitrate;
  let firstSide = maxLongSide;
  if (fitted !== null) {
    firstSide = Math.min(maxLongSide, sideForBitrate(fitted, maxLongSide));
  }

  let result = await encode(firstBitrate, firstSide);
  if (!result) {
    const fallbackMeta = meta;
    return {
      uri: source.uri,
      ...fallbackMeta,
      compressed: false,
      compressorUnavailable: false,
      exceedsLimit: (fallbackMeta.size ?? 0) > VIDEO_UPLOAD_LIMIT,
    };
  }

  // Tahmin tutmazsa düzeltme geçişleri: ölçülen boyuttan gereken bit hızı
  // hesaplanır, gerekirse çözünürlük bir kademe daha düşürülür. Geçiş sayısı
  // sabittir; amaç ilk denemede bitirmek, uzun videoda onlarca kodlama
  // yapmamak.
  let pass = 0;
  let currentBitrate = firstBitrate;
  let currentSide = firstSide;
  while ((result.size ?? 0) > target && pass < 2) {
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
    exceedsLimit: (result.size ?? 0) > VIDEO_UPLOAD_LIMIT,
  };
}

const posterCache = new Map<string, string>();

/**
 * Video için yerel bir kapak (ilk kare) üretir. Sonuç ekranlar arasında
 * paylaşılan bir bellek önbelleğinde tutulur; aynı video için tekrar
 * üretilmez.
 */
export async function generateVideoPoster(
  uri: string,
  timeMs = 400,
): Promise<{ uri: string; width: number | null; height: number | null } | null> {
  const key = `${uri}#${timeMs}`;
  const cached = posterCache.get(key);
  if (cached) {
    return { uri: cached, width: null, height: null };
  }
  const thumbnails = loadVideoThumbnails();
  if (!thumbnails) {
    return null;
  }
  try {
    const thumbnail = await thumbnails.getThumbnailAsync(uri, {
      time: Math.max(0, Math.min(timeMs, 1000)),
      quality: 0.72,
    });
    posterCache.set(key, thumbnail.uri);
    return {
      uri: thumbnail.uri,
      width: positive(thumbnail.width),
      height: positive(thumbnail.height),
    };
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
