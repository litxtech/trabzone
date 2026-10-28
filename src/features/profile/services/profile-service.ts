import type { PostgrestError } from '@supabase/supabase-js';

import { appError, type AppError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type Profile = {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  bio: string | null;
  city: string | null;
  district: string | null;
  website: string | null;
  avatar_path: string | null;
  cover_path: string | null;
  is_verified: boolean;
  onboarding_completed: boolean;
  followers_count: number;
  following_count: number;
  posts_count: number;
  created_at: string;
};

const PROFILE_COLUMNS =
  'id, username, first_name, last_name, bio, city, district, website, avatar_path, cover_path, is_verified, onboarding_completed, followers_count, following_count, posts_count, created_at';

const mapProfileError = (error: PostgrestError): AppError => {
  switch (error.message) {
    case 'username_taken':
      return appError('user_exists', 'Bu kullanıcı adı alınmış.');
    case 'username_invalid':
      return appError('unknown', 'Kullanıcı adı biçimi geçersiz.');
    case 'username_reserved':
      return appError('unknown', 'Bu kullanıcı adı ayrılmış.');
    case 'name_invalid':
      return appError('unknown', 'Ad ve soyad geçerli olmalı.');
    default:
      return appError('unknown');
  }
};

async function currentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }
  return data.user.id;
}

export async function fetchMyProfile(): Promise<Result<Profile | null>> {
  const userId = await currentUserId();
  if (!userId) {
    return ok(null);
  }

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle<Profile>();

  if (error) {
    return fail(appError('network'));
  }

  return ok(data);
}

export async function fetchMyRoles(): Promise<string[]> {
  const userId = await currentUserId();
  if (!userId) {
    return [];
  }

  const { data, error } = await supabase
    .from('user_role_assignments')
    .select('role_key')
    .eq('user_id', userId);

  if (error || !data) {
    return [];
  }
  return data.map((row) => String(row.role_key));
}

export async function completeRegistration(input: {
  username: string;
  firstName: string;
  lastName: string;
}): Promise<Result<Profile>> {
  const { data, error } = await supabase.rpc('complete_registration', {
    p_username: input.username,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
  });

  if (error) {
    return fail(mapProfileError(error));
  }

  return ok(data as Profile);
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_username_available', {
    p_username: username,
  });
  if (error) {
    return false;
  }
  return Boolean(data);
}

// -----------------------------------------------------------------------------
// Username change quota (haftada 1 + kayıt için 1 ek hak)
// -----------------------------------------------------------------------------

export type UsernameChangeStatus = {
  username: string;
  credits: number;
  last_changed_at: string | null;
  next_change_at: string | null;
  can_change: boolean;
};

export async function fetchUsernameChangeStatus(): Promise<Result<UsernameChangeStatus>> {
  const { data, error } = await supabase.rpc('profile_username_change_status');
  if (error) {
    return fail(mapProfileError(error));
  }
  return ok(data as UsernameChangeStatus);
}

export async function changeUsername(username: string): Promise<Result<UsernameChangeStatus>> {
  const { data, error } = await supabase.rpc('profile_change_username', {
    p_username: username,
  });

  if (error) {
    if (error.message.includes('username_cooldown')) {
      return fail(
        appError(
          'forbidden',
          'Kullanıcı adını haftada yalnızca bir kez değiştirebilirsin. Ek hakkın da doldu.',
        ),
      );
    }
    return fail(mapProfileError(error));
  }

  return ok({
    ...(data as { username: string; credits: number; next_change_at: string | null }),
    last_changed_at: new Date().toISOString(),
    can_change: false,
  });
}

// -----------------------------------------------------------------------------
// Editing
// -----------------------------------------------------------------------------

export type ProfilePatch = {
  firstName?: string;
  lastName?: string;
  bio?: string | null;
  city?: string | null;
  district?: string | null;
  website?: string | null;
  avatarPath?: string | null;
  coverPath?: string | null;
};

const mapUpdateError = (error: PostgrestError): AppError => {
  switch (error.code) {
    case '23514':
      if (error.message.includes('bio_length')) {
        return appError('invalid_input', 'Biyografi en fazla 300 karakter olabilir.');
      }
      if (error.message.includes('website_format')) {
        return appError('invalid_input', 'Web sitesi http:// veya https:// ile başlamalı.');
      }
      if (error.message.includes('name_length')) {
        return appError('invalid_input', 'Ad ve soyad 1-60 karakter arasında olmalı.');
      }
      return appError('invalid_input');
    case '42501':
      return appError('forbidden');
    default:
      return appError('network');
  }
};

const normalizeText = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function updateMyProfile(patch: ProfilePatch): Promise<Result<Profile>> {
  const userId = await currentUserId();
  if (!userId) {
    return fail(appError('session_missing'));
  }

  const payload: Record<string, string | null> = {};

  if (patch.firstName !== undefined) {
    payload.first_name = patch.firstName.trim();
  }
  if (patch.lastName !== undefined) {
    payload.last_name = patch.lastName.trim();
  }
  if (patch.bio !== undefined) {
    payload.bio = normalizeText(patch.bio);
  }
  if (patch.city !== undefined) {
    payload.city = normalizeText(patch.city);
  }
  if (patch.district !== undefined) {
    payload.district = normalizeText(patch.district);
  }
  if (patch.website !== undefined) {
    payload.website = normalizeText(patch.website);
  }
  if (patch.avatarPath !== undefined) {
    payload.avatar_path = patch.avatarPath;
  }
  if (patch.coverPath !== undefined) {
    payload.cover_path = patch.coverPath;
  }

  if (Object.keys(payload).length === 0) {
    const current = await fetchMyProfile();
    if (!current.ok || !current.data) {
      return fail(appError('unknown'));
    }
    return ok(current.data);
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single<Profile>();

  if (error) {
    return fail(mapUpdateError(error));
  }

  return ok(data);
}

// -----------------------------------------------------------------------------
// Privacy settings (own row only)
// -----------------------------------------------------------------------------

export type PrivacySettings = {
  profile_visibility: 'public' | 'followers' | 'private';
  discoverable: boolean;
  show_city: boolean;
  show_district: boolean;
  show_last_seen: boolean;
  show_online_status: boolean;
  read_receipts: boolean;
  allow_messages_from: 'everyone' | 'friends' | 'nobody';
  allow_friend_requests: boolean;
};

const PRIVACY_COLUMNS =
  'profile_visibility, discoverable, show_city, show_district, show_last_seen, show_online_status, read_receipts, allow_messages_from, allow_friend_requests';

export async function fetchMyPrivacySettings(): Promise<Result<PrivacySettings | null>> {
  const userId = await currentUserId();
  if (!userId) {
    return ok(null);
  }

  const { data, error } = await supabase
    .from('profile_settings')
    .select(PRIVACY_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle<PrivacySettings>();

  if (error) {
    return fail(appError('network'));
  }
  return ok(data ?? null);
}

export async function updateMyPrivacySettings(
  patch: Partial<PrivacySettings>,
): Promise<Result<PrivacySettings>> {
  const userId = await currentUserId();
  if (!userId) {
    return fail(appError('session_missing'));
  }
  if (Object.keys(patch).length === 0) {
    const current = await fetchMyPrivacySettings();
    if (!current.ok || !current.data) {
      return fail(appError('unknown'));
    }
    return ok(current.data);
  }

  const { data, error } = await supabase
    .from('profile_settings')
    .update(patch)
    .eq('user_id', userId)
    .select(PRIVACY_COLUMNS)
    .single<PrivacySettings>();

  if (error) {
    if (error.code === '42501' || error.message.includes('child_protection')) {
      return fail(
        appError(
          'forbidden',
          'Çocuk korumalı hesaplarda bu gizlilik ayarları sistem tarafından sabitlenir.',
        ),
      );
    }
    return fail(appError('network'));
  }

  return ok(data);
}

// -----------------------------------------------------------------------------
// App icon preference (restored on a new install)
// -----------------------------------------------------------------------------

export type AppIconId = 'aurora' | 'orbit' | 'nova';

export async function fetchMyAppIcon(): Promise<Result<AppIconId | null>> {
  const userId = await currentUserId();
  if (!userId) {
    return ok(null);
  }

  const { data, error } = await supabase
    .from('user_preferences')
    .select('app_icon')
    .eq('user_id', userId)
    .maybeSingle<{ app_icon: AppIconId }>();

  if (error) {
    return fail(appError('network'));
  }
  return ok(data?.app_icon ?? null);
}

export async function updateMyAppIcon(icon: AppIconId): Promise<Result<AppIconId>> {
  const userId = await currentUserId();
  if (!userId) {
    return fail(appError('session_missing'));
  }

  const { data, error } = await supabase
    .from('user_preferences')
    .update({ app_icon: icon })
    .eq('user_id', userId)
    .select('app_icon')
    .single<{ app_icon: AppIconId }>();

  if (error) {
    return fail(appError('network'));
  }
  return ok(data.app_icon);
}
