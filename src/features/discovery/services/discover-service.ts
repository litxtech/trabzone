import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type DiscoverSort = 'popular' | 'new' | 'city';

export type DiscoverProfile = {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  bio: string | null;
  city: string | null;
  avatar_path: string | null;
  is_verified: boolean;
  followers_count: number;
  created_at: string;
  is_following: boolean;
  profile_visibility: 'public' | 'followers' | 'private';
};

export const discoverQueryKeys = {
  list: (params: { query: string; city: string | null; sort: DiscoverSort }) =>
    ['discover', params.query, params.city, params.sort] as const,
};

export async function discoverPeople(params: {
  query?: string;
  city?: string | null;
  sort?: DiscoverSort;
  limit?: number;
  offset?: number;
}): Promise<Result<DiscoverProfile[]>> {
  const { data, error } = await supabase.rpc('people_discover', {
    p_query: params.query?.trim() ? params.query.trim() : null,
    p_city: params.city ?? null,
    p_sort: params.sort ?? 'popular',
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  });

  if (error) {
    return fail(rpcError(error));
  }

  return ok(((data as { items?: DiscoverProfile[] } | null)?.items ?? []) as DiscoverProfile[]);
}

/** Profil aramasında tek bir kullanıcıya gitmek için kullanılan hafif yardımcı. */
export async function findProfileIdByUsername(username: string): Promise<Result<string>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username.trim().toLowerCase())
    .maybeSingle<{ id: string }>();

  if (error) {
    return fail(appError('network'));
  }
  if (!data) {
    return fail(appError('not_found', 'Kullanıcı bulunamadı.'));
  }
  return ok(data.id);
}
