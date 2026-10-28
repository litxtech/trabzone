/**
 * Yolculuk modülündeki native modüller yalnızca gerektiğinde yüklenir.
 *
 * Expo modülleri statik olarak import edildiğinde, modülü içermeyen eski bir
 * dev-client derlemesinde uygulama ekranı hiç açılmadan çöker. Bu yardımcı,
 * yüklemeyi deneyip başarısız olursa `null` döner; ekranlar kontrollü bir
 * mesaj göstererek çalışmaya devam eder.
 */
export const NEEDS_DEV_BUILD =
  'Bu özellik için uygulamanın güncel bir yerel derlemesi gerekli. ' +
  'Geliştirme ortamında `npx expo run:ios` veya `npx expo run:android` ile yeniden derleyin.';

type Loader<T> = () => Promise<T>;

/**
 * Aynı modül için tek yükleme yapılır. Önceki sürüm yalnızca çözülmüş modülü
 * önbelleğe alıyordu; art arda iki çağrı iki ayrı `import` başlatıp dosya
 * seçicinin geç açılmasına yol açıyordu.
 */
const cache = new Map<string, Promise<unknown>>();

function load<T>(key: string, loader: Loader<T>): Promise<T | null> {
  const existing = cache.get(key);
  if (existing) {
    return existing as Promise<T | null>;
  }
  const pending = loader()
    .then((module) => module as T | null)
    .catch(() => null);
  cache.set(key, pending);
  return pending;
}

export type PrintModule = typeof import('expo-print');
export type SharingModule = typeof import('expo-sharing');
export type LocationModule = typeof import('expo-location');
export type DocumentPickerModule = typeof import('expo-document-picker');
export type ImagePickerModule = typeof import('expo-image-picker');

export const loadPrint = () => load<PrintModule>('expo-print', () => import('expo-print'));
export const loadSharing = () => load<SharingModule>('expo-sharing', () => import('expo-sharing'));
export const loadLocation = () =>
  load<LocationModule>('expo-location', () => import('expo-location'));
export const loadDocumentPicker = () =>
  load<DocumentPickerModule>('expo-document-picker', () => import('expo-document-picker'));
export const loadImagePicker = () =>
  load<ImagePickerModule>('expo-image-picker', () => import('expo-image-picker'));

/**
 * Belge seçici modülünü ekran açılırken ısıtır.
 *
 * İlk dokunuşta native modülün yüklenmesini beklemek, kullanıcıya "dosyalar
 * geç açılıyor" olarak yansıyordu. Yükleme arka planda biteceği için seçici
 * anında açılır.
 */
export function preloadDocumentModules(): void {
  void loadDocumentPicker();
}

export type PickedDocument = {
  uri: string;
  name: string;
  mime: string;
  size: number | null;
};

const isImageFile = (name: string, mime: string) =>
  mime.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(name);

export function isImageDocument(document: { name: string; mime: string }): boolean {
  return isImageFile(document.name, document.mime);
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
};

export function guessMime(name: string, fallback = 'application/pdf'): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? fallback;
}

/** Belge seçiciyi yükler ve ortak hata mesajıyla birlikte döner. */
export async function pickDocument(): Promise<
  { ok: true; document: PickedDocument | null } | { ok: false; message: string }
> {
  const picker = await loadDocumentPicker();
  if (!picker) {
    return { ok: false, message: NEEDS_DEV_BUILD };
  }
  try {
    const picked = await picker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets[0]) {
      return { ok: true, document: null };
    }
    const asset = picked.assets[0];
    return {
      ok: true,
      document: {
        uri: asset.uri,
        name: asset.name || 'belge.pdf',
        mime: asset.mimeType ?? guessMime(asset.name ?? ''),
        size: asset.size ?? null,
      },
    };
  } catch {
    return { ok: false, message: 'Belge seçilemedi. Tekrar dene.' };
  }
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) {
    return 'Boyut bilinmiyor';
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileNameFromPath(path: string): string {
  const clean = path.split('?')[0] ?? path;
  const name = clean.split('/').pop() ?? clean;
  return name.replace(/^\d{10,}-[a-z0-9]+-/, '') || name;
}
