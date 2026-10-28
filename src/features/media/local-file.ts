import { Platform } from 'react-native';

/**
 * Yerel dosya yardımcıları.
 *
 * `expo-file-system` legacy API'si yalnızca native tarafta çalışır (web'de
 * dosya URI'si yoktur). Bu yüzden modül tembel ve güvenli biçimde yüklenir;
 * web'de `null` döner ve çağıran katman bellek içi yola düşer.
 */
export type LegacyFileSystem = typeof import('expo-file-system/legacy');

let legacyFsPromise: Promise<LegacyFileSystem | null> | null = null;

export function loadLegacyFileSystem(): Promise<LegacyFileSystem | null> {
  if (Platform.OS === 'web') {
    return Promise.resolve(null);
  }
  if (!legacyFsPromise) {
    legacyFsPromise = import('expo-file-system/legacy')
      .then((module) => module)
      .catch(() => null);
  }
  return legacyFsPromise;
}

/** Dosyanın disk üzerindeki boyutu (byte). Bilinemezse `null`. */
export async function localFileSize(uri: string): Promise<number | null> {
  const fs = await loadLegacyFileSystem();
  if (!fs) {
    return null;
  }
  try {
    const info = await fs.getInfoAsync(uri);
    if (!info.exists) {
      return null;
    }
    const size = info.size;
    return typeof size === 'number' && size > 0 ? size : null;
  } catch {
    return null;
  }
}

/** Sıkıştırma çıktısı gibi geçici dosyaları sessizce siler. */
export async function releaseTempFile(uri: string): Promise<void> {
  const fs = await loadLegacyFileSystem();
  if (!fs) {
    return;
  }
  try {
    await fs.deleteAsync(uri, { idempotent: true });
  } catch {
    // Silinemezse sorun değil; işletim sistemi önbelleği kendisi temizler.
  }
}
