import type { LatLng, MapCamera, MapPoint } from '../types';

export type MapFocus = { camera: MapCamera; nonce: number };

/**
 * Platformdan bağımsız harita yüzeyi sözleşmesi.
 *
 * iOS (Apple Maps), Android (Mapbox) ve web (statik Mapbox) uygulamaları bu
 * propları birebir uygular. Ekranlar hangi motorun çalıştığını bilmez.
 */
export type MapCanvasProps = {
  /** Harita ilk açıldığında kullanılacak kamera. */
  initialCamera: MapCamera;
  /** Programatik kamera hareketleri (arama sonucu, konumum, rota). */
  focus?: MapFocus | null;
  markers: MapPoint[];
  route?: LatLng[] | null;
  /** Çizilen arama alanı (kapalı polygon). */
  polygon?: LatLng[] | null;
  userLocation?: LatLng | null;
  dark: boolean;
  /** Alt panelin kapladığı alan; kamera merkezi buna göre kaydırılır. */
  bottomInset?: number;
  interactive?: boolean;
  onMarkerPress: (point: MapPoint) => void;
  onCameraChange: (camera: MapCamera) => void;
  onMapPress?: (point: LatLng) => void;
};
