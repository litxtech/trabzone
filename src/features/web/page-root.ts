import { Platform } from 'react-native';

/**
 * Herkese açık web sayfalarının kök stili.
 *
 * Web'de sayfa kaydırması pencereye bırakıldığı için kök kutu içerik kadar
 * uzamalı; aksi halde `position: sticky` başlık yalnızca ilk ekran yüksekliği
 * boyunca yapışık kalıp sayfa kaydırıldığında yukarıda kalıyordu.
 *
 * Native tarafta ekranı dolduran klasik `flex: 1` davranışı korunur.
 */
export const webPageRoot =
  Platform.OS === 'web'
    ? ({ flexGrow: 1, flexShrink: 0 } as const)
    : ({ flex: 1 } as const);
