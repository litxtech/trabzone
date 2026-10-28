import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type DemoModuleKey = 'real_estate' | 'marketplace' | 'ride';

export type DemoModule = {
  key: DemoModuleKey;
  label: string;
  count: number;
  published: number;
  hint: string;
};

export type DemoUser = {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  district: string | null;
  created_at: string;
  real_estate: number;
  marketplace: number;
  ride_offers: number;
  vehicles: number;
};

export type DemoOverview = {
  modules: DemoModule[];
  users: DemoUser[];
  totals: {
    real_estate: number;
    marketplace: number;
    ride: number;
    users: number;
  };
  /** Örnek fotoğraflar Storage'a yüklendi mi? */
  media_ready: boolean;
};

export type DemoSeedResult = {
  ok: boolean;
  modules: DemoModuleKey[];
  real_estate: number;
  marketplace: number;
  ride: number;
  users: number;
};

export type DemoClearResult = {
  ok: boolean;
  modules: DemoModuleKey[];
  real_estate: number;
  marketplace: number;
  ride: number;
};

export type DemoUsersClearResult = {
  ok: boolean;
  removed: number;
};

export const demoQueryKeys = {
  overview: ['admin', 'demo', 'overview'] as const,
};

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as T);
}

export const fetchDemoOverview = () => rpc<DemoOverview>('admin_demo_overview');

export const seedDemoContent = (modules: DemoModuleKey[]) =>
  rpc<DemoSeedResult>('admin_demo_seed', { p_modules: modules });

export const clearDemoContent = (modules: DemoModuleKey[]) =>
  rpc<DemoClearResult>('admin_demo_clear', { p_modules: modules });

export const removeDemoUser = (userId: string) =>
  rpc<{ ok: boolean; user_id: string; username: string }>('admin_demo_user_remove', {
    p_user_id: userId,
  });

export const clearDemoUsers = () => rpc<DemoUsersClearResult>('admin_demo_users_clear');

export function formatDemoModuleSummary(result: DemoSeedResult | DemoClearResult): string {
  const parts: string[] = [];
  if (result.modules.includes('real_estate')) {
    parts.push(`${result.real_estate} emlak`);
  }
  if (result.modules.includes('marketplace')) {
    parts.push(`${result.marketplace} marketplace`);
  }
  if (result.modules.includes('ride')) {
    parts.push(`${result.ride} yolculuk`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Kayıt yok';
}
