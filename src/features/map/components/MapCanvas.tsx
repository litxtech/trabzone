import { MapCanvasFallback } from './MapCanvasFallback';
import type { MapCanvasProps } from './map-canvas-types';

/**
 * Yalnızca iOS (Apple Maps), Android (Mapbox) ve web (statik Mapbox) için
 * uygulamalar vardır. Bu dosya TypeScript çözümlemesi ve desteklenmeyen
 * platformlar için dürüst bir geri dönüştür.
 */
export function MapCanvas({ initialCamera, markers, onMarkerPress }: MapCanvasProps) {
  return (
    <MapCanvasFallback
      camera={initialCamera}
      markers={markers}
      message="Bu platformda native harita motoru bulunmuyor."
      onMarkerPress={onMarkerPress}
    />
  );
}
