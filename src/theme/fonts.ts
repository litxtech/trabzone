import { Ionicons } from '@expo/vector-icons';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora';
import { FontDisplay, useFonts, type FontSource } from 'expo-font';
import { Platform } from 'react-native';

const BRAND_FONTS: Record<string, FontSource> = {
  ...Ionicons.font,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
  Sora_600SemiBold,
  Sora_700Bold,
};

/**
 * Web'de `@font-face` kuralları `font-display: swap` ile üretilir; aksi halde
 * tarayıcı font inene kadar metni görünmez tutar (FOIT).
 */
const FONT_MAP: Record<string, FontSource> =
  Platform.OS === 'web'
    ? Object.fromEntries(
        Object.entries(BRAND_FONTS).map(([name, source]) => [
          name,
          typeof source === 'number' || typeof source === 'string'
            ? { uri: source, display: FontDisplay.SWAP }
            : source,
        ]),
      )
    : BRAND_FONTS;

/**
 * Registers every brand font. The splash screen stays up until `loaded` is
 * true so the first frame never renders with a fallback typeface.
 *
 * İkon fontu da burada yüklenir: `@expo/vector-icons` fontu ilk ikonda tembel
 * yüklediği için ilk ekranda ikonlar bir kare boş görünüyordu. Splash
 * arkasında hazır olunca tüm ikonlar ilk karede çizilir.
 */
export const useBrandFonts = () => useFonts(FONT_MAP);
