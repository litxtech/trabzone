import { useQuery } from '@tanstack/react-query';

import { discoverPeople, discoverQueryKeys, type DiscoverSort } from '../services/discover-service';
import { unwrap } from '@/utils/result';

export function useDiscoverPeople(params: {
  query: string;
  city: string | null;
  sort: DiscoverSort;
}) {
  return useQuery({
    queryKey: discoverQueryKeys.list(params),
    queryFn: () =>
      unwrap(discoverPeople({ query: params.query, city: params.city, sort: params.sort })),
    staleTime: 30_000,
  });
}
