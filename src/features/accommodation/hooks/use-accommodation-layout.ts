import { useWindowDimensions } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

export function useAccommodationLayout() {
  const { width, height } = useWindowDimensions();
  const { theme } = useTheme();
  return {
    width,
    height,
    isDesktop: width >= 1024,
    isTablet: width >= 720 && width < 1024,
    isMobile: width < 720,
    /** Konaklama vitrini tam genişlik kullanır; küçük ekranlarda da taşmaz. */
    contentWidth: width,
    /** Vitrin sayfalarının yatay dolgusu (geniş ekranda daha ferah nefes payı). */
    pagePadding: width >= 1600 ? 40 : width >= 1024 ? 28 : theme.layout.screenPadding,
    columns: width >= 1900 ? 6 : width >= 1500 ? 5 : width >= 1200 ? 4 : width >= 900 ? 3 : width >= 640 ? 2 : 1,
  };
}
