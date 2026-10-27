import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Oturum deposu.
 *
 * - iOS/Android: SecureStore (Keychain / Keystore). Android'de tek deger
 *   siniri oldugu icin buyuk oturumlar parcalanarak yazilir.
 * - Web: SecureStore desteklenmedigi icin AsyncStorage (localStorage) kullanilir.
 *
 * SecureStore anahtarlari yalnizca harf, rakam, ".", "-" ve "_" kabul eder;
 * bu yuzden anahtarlar normalize edilir.
 */
const CHUNK_SIZE = 1800;
const isWeb = Platform.OS === 'web';

const normalizeKey = (key: string) => key.replace(/[^\w.-]/g, '_');
const chunkKey = (key: string, index: number) => `${normalizeKey(key)}_chunk_${index}`;
const countKey = (key: string) => `${normalizeKey(key)}_count`;

async function readRaw(key: string): Promise<string | null> {
  try {
    return isWeb ? await AsyncStorage.getItem(key) : await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeRaw(key: string, value: string): Promise<void> {
  try {
    if (isWeb) {
      await AsyncStorage.setItem(key, value);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  } catch {
    // Depolama reddederse oturum bellekte kalir; uygulama cokmez.
  }
}

async function deleteRaw(key: string): Promise<void> {
  try {
    if (isWeb) {
      await AsyncStorage.removeItem(key);
    } else {
      await SecureStore.deleteItemAsync(key);
    }
  } catch {
    // Silinecek bir sey yoksa yoksay.
  }
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    // Web'de boyut siniri yok: parcalama yapilmaz.
    if (isWeb) {
      return readRaw(normalizeKey(key));
    }

    const countRaw = await readRaw(countKey(key));
    if (!countRaw) {
      return null;
    }

    const count = Number.parseInt(countRaw, 10);
    if (!Number.isFinite(count) || count <= 0) {
      return null;
    }

    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) => readRaw(chunkKey(key, index))),
    );

    if (chunks.some((chunk) => chunk === null)) {
      await secureStorage.removeItem(key);
      return null;
    }

    return chunks.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    if (isWeb) {
      await writeRaw(normalizeKey(key), value);
      return;
    }

    const chunks = value.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, 'g')) ?? [''];
    await Promise.all(chunks.map((chunk, index) => writeRaw(chunkKey(key, index), chunk)));
    await writeRaw(countKey(key), String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    if (isWeb) {
      await deleteRaw(normalizeKey(key));
      return;
    }

    const countRaw = await readRaw(countKey(key));
    const count = countRaw ? Number.parseInt(countRaw, 10) : 0;
    await Promise.all([
      ...Array.from({ length: Number.isFinite(count) ? count : 0 }, (_, index) =>
        deleteRaw(chunkKey(key, index)),
      ),
      deleteRaw(countKey(key)),
    ]);
  },
};
