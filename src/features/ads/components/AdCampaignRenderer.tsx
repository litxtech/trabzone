import { useRef, type ComponentRef } from 'react';
import { Platform, type View, type ViewStyle } from 'react-native';

import { openAdDestination, resolveAdDestination } from '../destination';
import { adProviderAdapter } from '../providers';
import { trackAdClick, useAdImpressionTracker } from '../tracking';
import type { AdPlacementKey, AdSlot, ServedAd } from '../types';
import { PremiumGlassAdBanner } from './PremiumGlassAdBanner';

function imageFor(ad: ServedAd): string {
  if (Platform.OS === 'web') {
    return ad.web_image_url ?? ad.image_url;
  }
  return ad.mobile_image_url ?? ad.image_url;
}

/**
 * Kaynağa göre doğru sunumu seçer: TRABZONE_DIRECT reklamları Glass Banner
 * ile çizilir ve Trabzone takipçileri kullanılır; üçüncü taraf sağlayıcılar
 * kendi SDK bileşenini çizer ve tıklamaları kendileri yönetir.
 */
export function AdCampaignRenderer({
  slot,
  placement,
  onMenu,
  style,
}: {
  slot: AdSlot;
  placement: AdPlacementKey;
  onMenu?: (ad: ServedAd) => void;
  style?: ViewStyle;
}) {
  if (slot.kind === 'provider') {
    const adapter = adProviderAdapter(slot.fallback.provider);
    const Slot = adapter?.isReady() ? adapter.SlotComponent : null;
    return Slot ? <Slot unitId={slot.fallback.unit_id} placement={placement} /> : null;
  }
  return <DirectAd slot={slot} onMenu={onMenu} style={style} />;
}

function DirectAd({
  slot,
  onMenu,
  style,
}: {
  slot: Extract<AdSlot, { kind: 'direct' }>;
  onMenu?: (ad: ServedAd) => void;
  style?: ViewStyle;
}) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const { ad } = slot;
  useAdImpressionTracker(ref, {
    serveId: ad.serve_id,
    minRatio: slot.minVisibleRatio,
    minMs: slot.minViewMs,
  });

  return (
    <PremiumGlassAdBanner
      ref={ref}
      title={ad.title}
      description={ad.description}
      ctaLabel={ad.cta_label}
      businessName={ad.business_name ?? ad.advertiser_name}
      imageUrl={imageFor(ad)}
      imageFocus={ad.image_focus}
      style={style}
      onPress={() => {
        trackAdClick(ad.serve_id);
        void openAdDestination(resolveAdDestination(ad.campaign_id, ad.destination));
      }}
      onMenu={onMenu ? () => onMenu(ad) : undefined}
    />
  );
}
