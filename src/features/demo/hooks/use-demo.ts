import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import * as demo from '../services/demo-service';
import { demoQueryKeys, type DemoModuleKey } from '../services/demo-service';

export function useDemoOverview() {
  return useQuery({
    queryKey: demoQueryKeys.overview,
    queryFn: async () => unwrap(await demo.fetchDemoOverview()),
    staleTime: 20_000,
  });
}

function useDemoInvalidate() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: demoQueryKeys.overview });
    // Örnek içerik akışları da etkiler: yönetici sayaçları ve listeler tazelensin.
    void client.invalidateQueries({ queryKey: ['admin'] });
    void client.invalidateQueries({ queryKey: ['market'] });
    void client.invalidateQueries({ queryKey: ['explore'] });
    void client.invalidateQueries({ queryKey: ['ride'] });
  };
}

export function useDemoSeed() {
  const invalidate = useDemoInvalidate();
  return useMutation({
    mutationFn: async (modules: DemoModuleKey[]) =>
      unwrap(await demo.seedDemoContent(modules)),
    onSuccess: invalidate,
  });
}

export function useDemoClear() {
  const invalidate = useDemoInvalidate();
  return useMutation({
    mutationFn: async (modules: DemoModuleKey[]) =>
      unwrap(await demo.clearDemoContent(modules)),
    onSuccess: invalidate,
  });
}

export function useDemoUserRemove() {
  const invalidate = useDemoInvalidate();
  return useMutation({
    mutationFn: async (userId: string) => unwrap(await demo.removeDemoUser(userId)),
    onSuccess: invalidate,
  });
}

export function useDemoUsersClear() {
  const invalidate = useDemoInvalidate();
  return useMutation({
    mutationFn: async () => unwrap(await demo.clearDemoUsers()),
    onSuccess: invalidate,
  });
}
