import { useLocalSearchParams } from 'expo-router';

import { HubScreen } from '@/features/seo-hubs/components/HubScreen';

/**
 * `/trabzon/{ilçe}/{bölüm}/{kategori}` — sunucu tarafı aynı adresi
 * `api/hub.js` ile işler; bu ekran istemci tarafındaki gezinme ve derin
 * bağlantılar için aynı veriyi kullanır.
 */
export default function TrabzonHubDetailRoute() {
  const params = useLocalSearchParams<{ hub?: string | string[] }>();
  const raw = params.hub;
  const segments = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);

  return <HubScreen segments={segments} />;
}
