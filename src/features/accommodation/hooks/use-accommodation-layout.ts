import { useWindowDimensions } from 'react-native';

export function useAccommodationLayout() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isDesktop: width >= 1024,
    isTablet: width >= 720 && width < 1024,
    isMobile: width < 720,
    contentWidth: Math.min(width, 1280),
    columns: width >= 1200 ? 4 : width >= 900 ? 3 : width >= 640 ? 2 : 1,
  };
}
