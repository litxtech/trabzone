import type { ComponentType } from 'react';

import type { AdPlacementKey, AdSource } from '../types';
import { admobAdapter } from './admob';

export type AdProviderSlotProps = {
  unitId: string;
  placement: AdPlacementKey;
};

/**
 * Üçüncü taraf reklam sağlayıcı sözleşmesi.
 *
 * - Sağlayıcı kendi SDK görünümünü çizer; reklam etiketi, AdChoices ve
 *   tıklama yönlendirmesi SDK'ya aittir. Trabzone bu reklamlara tıklama
 *   dinleyicisi eklemez ve reklam detay sayfasına yönlendirmez.
 * - `isReady()` false iken yerleşim hiç satır açmaz; boş reklam çerçevesi
 *   gösterilmez.
 * - Gösterim/tıklama metrikleri sağlayıcı panelinde kalır; Trabzone
 *   kampanya metrikleriyle karıştırılmaz.
 */
export type AdProviderAdapter = {
  source: Exclude<AdSource, 'trabzone_direct'>;
  isReady: () => boolean;
  SlotComponent: ComponentType<AdProviderSlotProps> | null;
};

const ADAPTERS: Record<Exclude<AdSource, 'trabzone_direct'>, AdProviderAdapter> = {
  google_admob: admobAdapter,
};

export function adProviderAdapter(source: AdSource): AdProviderAdapter | null {
  if (source === 'trabzone_direct') {
    return null;
  }
  return ADAPTERS[source] ?? null;
}

export function isAdProviderReady(source: AdSource): boolean {
  return adProviderAdapter(source)?.isReady() ?? false;
}
