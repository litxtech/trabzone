import * as Clipboard from 'expo-clipboard';
import { Alert, Linking } from 'react-native';

import { haptics } from '@/utils/haptics';

import { SUPPORT_EMAIL } from '../constants';

/**
 * Cihazda e-posta uygulamasi varsa mailto acar; yoksa adresi panoya kopyalayip
 * kullaniciya bilgi verir. `support@litxtech.com` her zaman ulasilabilir kalir.
 */
export async function contactSupportByEmail(subject = 'Trabzone destek talebi'): Promise<void> {
  const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      throw new Error('mailto_unavailable');
    }
    await Linking.openURL(url);
  } catch {
    await Clipboard.setStringAsync(SUPPORT_EMAIL);
    haptics.success();
    Alert.alert(
      'E-posta adresi kopyalandı',
      `${SUPPORT_EMAIL} adresini panoya kopyaladık. Cihazında e-posta uygulaması yoksa bu adrese web tarayıcından da yazabilirsin.`,
      [{ text: 'Tamam' }],
    );
  }
}

export async function copySupportEmail(): Promise<void> {
  await Clipboard.setStringAsync(SUPPORT_EMAIL);
  haptics.success();
}
