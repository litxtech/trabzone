import { useLocalSearchParams } from 'expo-router';

import { PlaceDetailSheet } from '@/features/explore/components/PlaceDetailSheet';
import { useRouter } from '@/utils/router';

/**
 * İşletme detayı tek bir kaynaktan beslenir: Keşfet'teki premium işletme
 * profilinin aynısı burada tam ekran açılır. Fotoğraf/video galerisi ortak
 * `MarketMediaViewer` bileşenini kullanır.
 */
export default function MarketPlaceDetailRoute() {
  const params = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const placeId = typeof params.id === 'string' ? params.id : null;

  return (
    <PlaceDetailSheet
      visible
      placeId={placeId}
      onClose={() => router.back()}
      onManage={(id) => router.push(`/business/${id}` as never)}
    />
  );
}
