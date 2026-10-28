import { Ionicons } from '@expo/vector-icons';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora';
import { useFonts } from 'expo-font';

/**
 * Registers every brand font. The splash screen stays up until `loaded` is
 * true so the first frame never renders with a fallback typeface.
 *
 * İkon fontu da burada yüklenir: `@expo/vector-icons` fontu ilk ikonda tembel
 * yüklediği için ilk ekranda ikonlar bir kare boş görünüyordu. Splash
 * arkasında hazır olunca tüm ikonlar ilk karede çizilir.
 */
export const useBrandFonts = () =>
  useFonts({
    ...Ionicons.font,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    Sora_600SemiBold,
    Sora_700Bold,
  });
