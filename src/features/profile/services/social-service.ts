import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type DirectoryProfile = {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  bio: string | null;
  city: string | null;
  avatar_path: string | null;
  is_verified: boolean;
  followers_count: number;
  created_at: string;
};

const DIRECTORY_COLUMNS =
  'id, username, first_name, last_name, bio, city, avatar_path, is_verified, followers_count, created_at';

async function currentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }
  return data.user.id;
}

/** Engelledigim kisiler; akista ve kesifte gosterilmez. */
export async function fetchBlockedUserIds(): Promise<string[]> {
  const { data, error } = await supabase.from('user_blocks').select('blocked_id');
  if (error || !data) {
    return [];
  }
  return data.map((row) => String(row.blocked_id));
}

export async function fetchFollowingIds(): Promise<string[]> {
  const userId = await currentUserId();
  if (!userId) {
    return [];
  }

  const { data, error } = await supabase
    .from('user_follows')
    .select('following_id')
    .eq('follower_id', userId);

  if (error || !data) {
    return [];
  }
  return data.map((row) => String(row.following_id));
}

/**
 * Kesif havuzu: son katilan, aktif ve profilini tamamlamis uyeler.
 * Engellenen hesaplar istemci tarafinda elenir (RLS sadece kendi
 * engellerimizi gormemize izin verir).
 */
export async function fetchSuggestedProfiles(
  limit = 12,
): Promise<Result<DirectoryProfile[]>> {
  const userId = await currentUserId();
  if (!userId) {
    return fail(appError('session_missing'));
  }

  const [{ data, error }, blocked] = await Promise.all([
    supabase
      .from('profiles')
      .select(DIRECTORY_COLUMNS)
      .eq('account_status', 'active')
      .eq('onboarding_completed', true)
      .neq('id', userId)
      .order('created_at', { ascending: false })
      .limit(limit + 8),
    fetchBlockedUserIds(),
  ]);

  if (error) {
    return fail(appError('network'));
  }

  const blockedSet = new Set(blocked);
  const profiles = (data ?? [])
    .filter((row) => !blockedSet.has(String(row.id)))
    .slice(0, limit) as DirectoryProfile[];

  return ok(profiles);
}

export async function fetchProfileById(id: string): Promise<Result<DirectoryProfile | null>> {
  const { data, error } = await supabase
    .from('profiles')
    .select(DIRECTORY_COLUMNS)
    .eq('id', id)
    .eq('account_status', 'active')
    .maybeSingle<DirectoryProfile>();

  if (error) {
    return fail(appError('network'));
  }
  return ok(data ?? null);
}

export async function followUser(userId: string): Promise<Result<null>> {
  const me = await currentUserId();
  if (!me) {
    return fail(appError('session_missing'));
  }
  if (me === userId) {
    return fail(appError('invalid_input', 'Kendini takip edemezsin.'));
  }

  const { error } = await supabase
    .from('user_follows')
    .insert({ follower_id: me, following_id: userId });

  if (error) {
    // 23505: zaten takip ediliyor - istenen sonuc zaten saglanmis.
    if (error.code === '23505') {
      return ok(null);
    }
    return fail(appError('network'));
  }
  return ok(null);
}

export async function unfollowUser(userId: string): Promise<Result<null>> {
  const me = await currentUserId();
  if (!me) {
    return fail(appError('session_missing'));
  }

  const { error } = await supabase
    .from('user_follows')
    .delete()
    .eq('follower_id', me)
    .eq('following_id', userId);

  if (error) {
    return fail(appError('network'));
  }
  return ok(null);
}

// -----------------------------------------------------------------------------
// Public profile view (privacy enforced server-side)
// -----------------------------------------------------------------------------

export type ProfileView = {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  bio: string | null;
  city: string | null;
  district: string | null;
  website: string | null;
  avatar_path: string | null;
  cover_path: string | null;
  is_verified: boolean;
  followers_count: number;
  following_count: number;
  posts_count: number;
  created_at: string;
  visibility: 'public' | 'followers' | 'private';
  restricted: boolean;
  is_me: boolean;
  i_follow: boolean;
  follows_me: boolean;
  is_friend: boolean;
  friend_request_out: string | null;
  friend_request_in: string | null;
  blocked: boolean;
  blocked_by_me: boolean;
  accepts_friend_requests: boolean;
};

export async function fetchProfileView(username: string): Promise<Result<ProfileView | null>> {
  const { data, error } = await supabase.rpc('get_profile_view', {
    p_username: username,
  });

  if (error) {
    return fail(appError('network'));
  }

  const rows = Array.isArray(data) ? (data as ProfileView[]) : [];
  return ok(rows[0] ?? null);
}

export type ConnectionItem = {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  bio: string | null;
  city: string | null;
  avatar_path: string | null;
  is_verified: boolean;
  followers_count: number;
  is_following: boolean;
};

export type ConnectionKind = 'followers' | 'following';

export async function fetchConnections(
  userId: string,
  kind: ConnectionKind,
  limit = 30,
  offset = 0,
): Promise<Result<ConnectionItem[]>> {
  const { data, error } = await supabase.rpc('list_connections', {
    p_user_id: userId,
    p_kind: kind,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return fail(appError('network'));
  }
  return ok((data ?? []) as ConnectionItem[]);
}

// -----------------------------------------------------------------------------
// Friend requests
// -----------------------------------------------------------------------------

export type FriendRequestItem = {
  id: string;
  direction: 'in' | 'out';
  status: 'pending';
  message: string | null;
  created_at: string;
  user_id: string;
  username: string;
  first_name: string;
  last_name: string;
  avatar_path: string | null;
  is_verified: boolean;
};

export async function fetchFriendRequests(): Promise<Result<FriendRequestItem[]>> {
  const { data, error } = await supabase.rpc('list_friend_requests');

  if (error) {
    return fail(appError('network'));
  }
  return ok((data ?? []) as FriendRequestItem[]);
}

export async function sendFriendRequest(
  userId: string,
  message?: string,
): Promise<Result<null>> {
  const me = await currentUserId();
  if (!me) {
    return fail(appError('session_missing'));
  }

  const { error } = await supabase.from('friend_requests').insert({
    sender_id: me,
    receiver_id: userId,
    message: message?.trim() ? message.trim().slice(0, 200) : null,
  });

  if (error) {
    if (error.code === '23505') {
      return fail(appError('duplicate', 'Bu kişiye zaten bekleyen bir istek gönderdin.'));
    }
    if (error.code === '42501') {
      return fail(
        appError('forbidden', 'Bu kişi şu anda arkadaşlık isteği kabul etmiyor.'),
      );
    }
    return fail(appError('network'));
  }
  return ok(null);
}

export async function respondFriendRequest(
  requestId: string,
  action: 'accepted' | 'rejected',
): Promise<Result<null>> {
  const { error } = await supabase
    .from('friend_requests')
    .update({ status: action })
    .eq('id', requestId)
    .eq('status', 'pending');

  if (error) {
    if (error.code === '42501' || error.message.includes('not_allowed')) {
      return fail(appError('forbidden', 'Bu isteği yanıtlama yetkin yok.'));
    }
    return fail(appError('network'));
  }
  return ok(null);
}

export async function cancelFriendRequest(requestId: string): Promise<Result<null>> {
  const { error } = await supabase
    .from('friend_requests')
    .update({ status: 'cancelled' })
    .eq('id', requestId)
    .eq('status', 'pending');

  if (error) {
    if (error.code === '42501' || error.message.includes('not_allowed')) {
      return fail(appError('forbidden', 'Bu istek artık iptal edilemez.'));
    }
    return fail(appError('network'));
  }
  return ok(null);
}

// -----------------------------------------------------------------------------
// Blocking
// -----------------------------------------------------------------------------

export async function blockUser(userId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('block_user', { p_user_id: userId });
  if (error) {
    return fail(appError('network'));
  }
  return ok(null);
}

export async function unblockUser(userId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('unblock_user', { p_user_id: userId });
  if (error) {
    return fail(appError('network'));
  }
  return ok(null);
}
