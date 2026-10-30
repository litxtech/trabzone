import { memo, useState } from 'react';
import { Alert, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ActionSheet } from '@/components/ui';

import { sendAdFeedback } from '../services/ads-service';
import { AD_FEEDBACK_REASONS, type AdFeedbackReason, type AdPlacementKey, type AdSlot, type ServedAd } from '../types';
import { AdCampaignRenderer } from './AdCampaignRenderer';

type Props = {
  slot: AdSlot | null;
  placement: AdPlacementKey;
  onHide: (campaignId: string) => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Akış içindeki tek reklam yeri. Reklam yoksa hiçbir şey çizmez (boş çerçeve
 * oluşmaz). Doğrudan kampanyalarda kullanıcı reklamı gizleyebilir,
 * bildirebilir ve neden gösterildiğini öğrenebilir.
 */
export const AdPlacementSlot = memo(function AdPlacementSlot({ slot, placement, onHide, style }: Props) {
  const [menuAd, setMenuAd] = useState<ServedAd | null>(null);
  const [reportAd, setReportAd] = useState<ServedAd | null>(null);

  if (!slot) {
    return null;
  }

  const hide = (ad: ServedAd, kind: 'hide' | 'report', reason?: AdFeedbackReason) => {
    onHide(ad.campaign_id);
    void sendAdFeedback({ campaignId: ad.campaign_id, kind, reason: reason ?? null }).then((result) => {
      if (kind === 'report') {
        Alert.alert(
          result.ok ? 'Bildirimin alındı' : 'Bildirim gönderilemedi',
          result.ok
            ? 'Reklam incelemeye alınacak ve sana bir süre gösterilmeyecek.'
            : 'Bağlantını kontrol edip tekrar dene.',
        );
      }
    });
  };

  return (
    <View style={[styles.wrap, style]}>
      <AdCampaignRenderer slot={slot} placement={placement} onMenu={setMenuAd} />

      <ActionSheet
        visible={menuAd != null}
        title="Reklam"
        message={menuAd ? `${menuAd.advertiser_name} tarafından sponsorlu içerik` : undefined}
        items={[
          { key: 'hide', label: 'Bu reklamı gizle', icon: 'eye-off-outline' },
          { key: 'report', label: 'Reklamı bildir', icon: 'flag-outline', destructive: true },
          { key: 'why', label: 'Bu reklamı neden görüyorum?', icon: 'information-circle-outline' },
        ]}
        onClose={() => setMenuAd(null)}
        onSelect={(key) => {
          const ad = menuAd;
          setMenuAd(null);
          if (!ad) {
            return;
          }
          if (key === 'hide') {
            hide(ad, 'hide');
          } else if (key === 'report') {
            setReportAd(ad);
          } else {
            Alert.alert(
              'Bu reklamı neden görüyorum?',
              'Reklamlar bulunduğun akışa ve profilinde seçtiğin ilçeye göre gösterilir. ' +
                'Kişisel ilgi alanı profili, kesin konum veya reklam kimliği kullanılmaz. ' +
                'Gizlediğin reklamlar bir süre tekrar gösterilmez.',
            );
          }
        }}
      />

      <ActionSheet
        visible={reportAd != null}
        title="Reklamı bildir"
        message="Bildirimler yöneticiler tarafından incelenir."
        items={AD_FEEDBACK_REASONS.map((reason) => ({ key: reason.key, label: reason.label }))}
        onClose={() => setReportAd(null)}
        onSelect={(key) => {
          const ad = reportAd;
          setReportAd(null);
          if (ad) {
            hide(ad, 'report', key as AdFeedbackReason);
          }
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { paddingVertical: 10 },
});
