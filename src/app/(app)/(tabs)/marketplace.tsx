import { FeatureNotice } from '@/features/navigation/components/FeatureNotice';

export default function MarketplaceScreen() {
  return (
    <FeatureNotice
      headerTitle="Marketplace"
      icon="storefront-outline"
      title="Marketplace hazırlanıyor"
      description="Trabzone Marketplace; ürün listeleme, güvenli ödeme ve sipariş takibini tek yerde toplayacak."
      bullets={[
        'Fotoğraflı ilan oluşturma ve kategori keşfi',
        'Güvenli ödeme (Stripe) ve korumalı teslimat',
        'Satıcı puanları, favoriler ve sipariş takibi',
      ]}
    />
  );
}
