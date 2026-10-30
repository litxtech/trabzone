import { useLocalSearchParams } from 'expo-router';

import { AdDetailScreen } from '@/features/ads/components/AdDetailScreen';

export default function AdDetailRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  return <AdDetailScreen id={typeof params.id === 'string' ? params.id.toLowerCase() : ''} />;
}
