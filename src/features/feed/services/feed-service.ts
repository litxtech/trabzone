import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type FeedFilter = 'all' | 'nearby' | 'following' | 'popular';
export type PostVisibility = 'public' | 'followers';

export type PostMedia = {
  id: string;
  storage_path: string;
  thumbnail_path: string | null;
  media_type: 'image' | 'video';
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  /** Sunucunun önerdiği çerçeveleme; 'auto' ise istemci orana göre karar verir. */
  display_fit?: 'auto' | 'cover' | 'contain' | null;
};

export type PostNewsMeta = {
  post_id?: string;
  kind: 'ai' | 'source' | string;
  slug?: string | null;
  title: string;
  subtitle?: string | null;
  spot?: string | null;
  lead?: string | null;
  preview?: string | null;
  body_format?: 'short' | 'standard' | 'extended' | string | null;
  word_count?: number | null;
  reading_minutes?: number | null;
  /** Admin > Haber kalitesi ayarından gelen akış önizleme satır sayısı. */
  preview_lines?: number | null;
  category_slug?: string | null;
  category_name?: string | null;
  district?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  ai_generated?: boolean;
  source_count?: number | null;
  sources?: {
    domain: string;
    kind: string;
    url: string;
    title: string | null;
    retrieved_at?: string | null;
  }[] | null;
};

export type PostSource = {
  name: string;
  username: string | null;
  domain: string | null;
  url: string | null;
  logo_url: string | null;
  verified: boolean;
  author: string | null;
  mode: string | null;
  attribution: string | null;
  license_status: string | null;
  same_as_author: boolean;
  published_at: string | null;
  /** Kaynak haberlerinde akış kartı için birleşik haber meta'sı. */
  post_id?: string;
  kind?: string;
  slug?: string | null;
  title?: string | null;
  subtitle?: string | null;
  spot?: string | null;
  lead?: string | null;
  preview?: string | null;
  body_format?: string | null;
  word_count?: number | null;
  preview_lines?: number | null;
  category_slug?: string | null;
  category_name?: string | null;
  district?: string | null;
  updated_at?: string | null;
  ai_generated?: boolean;
  source_count?: number | null;
};

/**
 * Anlık gelişme özeti. `posts` kaydına 1:1 bağlı `live_news` satırıdır; aynı
 * kanonik `post_id` akışta, Reels'te, ilçe akışında ve web sayfasında kullanılır.
 */
export type PostLiveNewsMeta = {
  post_id: string;
  canonical_id: string;
  title: string;
  summary: string | null;
  category: string;
  city: string;
  district: string | null;
  location_precision: 'none' | 'district' | 'city' | 'approximate';
  media_kind: 'text' | 'photo' | 'video' | 'mixed';
  publish_targets: string[];
  cross_post_reel: boolean;
  reel_id: string | null;
  verification_status:
    | 'citizen'
    | 'reviewing'
    | 'verified'
    | 'corrected'
    | 'unverified'
    | 'removed';
  verification_note: string | null;
  verified_at: string | null;
  moderation_status: 'pending' | 'visible' | 'hidden' | 'removed';
  risk_level: 'low' | 'medium' | 'high' | null;
  risk_flags: string[];
  usage_consent: boolean;
  newsroom_state: string;
  published_at: string | null;
  reports_count: number;
  is_mine: boolean;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

export type FeedPost = {
  id: string;
  author_id: string;
  author_username: string;
  author_first_name: string | null;
  author_last_name: string | null;
  author_avatar_path: string | null;
  author_is_verified: boolean;
  /**
   * Yazar 18 yaş altı (kısıtlanmış hesap) mı?
   *
   * Sunucu bu alanı yalnızca gönderiyi görebilen kişilere döner; çocuk
   * hesapların gönderileri zaten arkadaş dışına kapalıdır.
   */
  author_is_child_protected?: boolean;
  body: string | null;
  visibility: PostVisibility;
  city: string | null;
  moderation_status: string;
  like_count: number;
  comment_count: number;
  save_count: number;
  share_count: number;
  /** Hesap bazlı tekil görüntüleme (cihazdan bağımsız). */
  view_count?: number;
  /** Geçmişte tekil doğrulanmamış toplam; ayrı metrik olarak tutulur. */
  view_legacy_count?: number;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
  liked: boolean;
  saved: boolean;
  is_mine: boolean;
  news?: PostNewsMeta | null;
  source?: PostSource | null;
  /** Varsa içerik anlık gelişmedir (vatandaş muhabirliği). */
  live_news?: PostLiveNewsMeta | null;
  /** Yalnızca `live_news_list` yakınımda filtresinde döner. */
  distance_km?: number | null;
  media: PostMedia[];
};

export type FeedPage = {
  items: FeedPost[];
  next_cursor: string | null;
  has_more: boolean;
};

export type PostComment = {
  id: string;
  post_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  is_mine: boolean;
  can_delete: boolean;
  author_id: string;
  author_username: string;
  author_first_name: string | null;
  author_last_name: string | null;
  author_avatar_path: string | null;
  author_is_verified: boolean;
};

export type PostMediaInput = {
  storage_path: string;
  thumbnail_path?: string | null;
  media_type: 'image' | 'video';
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
};

export const feedQueryKeys = {
  feed: (filter: FeedFilter, city: string | null) => ['feed', 'list', filter, city] as const,
  post: (postId: string) => ['feed', 'post', postId] as const,
  comments: (postId: string) => ['feed', 'comments', postId] as const,
  saved: ['feed', 'saved'] as const,
  profile: (username: string, kind: 'posts' | 'media' | 'news') =>
    ['feed', 'profile', username, kind] as const,
  storyFeed: ['stories', 'feed'] as const,
  storyUser: (userId: string) => ['stories', 'user', userId] as const,
  storyViewers: (storyId: string) => ['stories', 'viewers', storyId] as const,
};

// -----------------------------------------------------------------------------
// Feed
// -----------------------------------------------------------------------------

export async function fetchFeed(params: {
  filter?: FeedFilter;
  city?: string | null;
  cursor?: string | null;
  limit?: number;
}): Promise<Result<FeedPage>> {
  const { data, error } = await supabase.rpc('feed_list', {
    p_filter: params.filter ?? 'all',
    p_city: params.city ?? null,
    p_cursor: params.cursor ?? null,
    p_limit: params.limit ?? 12,
  });

  if (error) {
    return fail(rpcError(error));
  }

  const page = (data ?? {}) as FeedPage;
  return ok({
    items: page.items ?? [],
    next_cursor: page.next_cursor ?? null,
    has_more: Boolean(page.has_more),
  });
}

export async function fetchPost(postId: string): Promise<Result<FeedPost | null>> {
  const { data, error } = await supabase.rpc('feed_get_post', { p_post_id: postId });

  if (error) {
    return fail(rpcError(error));
  }
  return ok((data as FeedPost | null) ?? null);
}

export async function createPost(input: {
  body: string | null;
  media: PostMediaInput[];
  visibility: PostVisibility;
  city: string | null;
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('feed_create_post', {
    p_body: input.body,
    p_media: input.media,
    p_visibility: input.visibility,
    p_city: input.city,
  });

  if (error) {
    return fail(rpcError(error));
  }

  const id = (data as { id?: string } | null)?.id;
  if (!id) {
    return fail(appError('unknown'));
  }
  return ok(id);
}

export async function updatePost(input: {
  postId: string;
  body: string | null;
  visibility?: PostVisibility;
}): Promise<Result<FeedPost>> {
  const { data, error } = await supabase.rpc('feed_update_post', {
    p_post_id: input.postId,
    p_body: input.body,
    p_visibility: input.visibility ?? null,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as FeedPost);
}

export async function deletePost(postId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('feed_delete_post', { p_post_id: postId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function togglePostLike(
  postId: string,
): Promise<Result<{ liked: boolean; like_count: number }>> {
  const { data, error } = await supabase.rpc('feed_toggle_like', { p_post_id: postId });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as { liked: boolean; like_count: number });
}

export async function togglePostSave(postId: string): Promise<Result<{ saved: boolean }>> {
  const { data, error } = await supabase.rpc('feed_toggle_save', { p_post_id: postId });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as { saved: boolean });
}

export async function sharePost(postId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('feed_share_post', { p_post_id: postId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function fetchSavedPosts(limit = 18, offset = 0): Promise<Result<FeedPost[]>> {
  const { data, error } = await supabase.rpc('feed_list_saved', {
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: FeedPost[] } | null)?.items ?? []) as FeedPost[]);
}

// -----------------------------------------------------------------------------
// Comments
// -----------------------------------------------------------------------------

export async function fetchComments(
  postId: string,
  limit = 40,
  offset = 0,
): Promise<Result<PostComment[]>> {
  const { data, error } = await supabase.rpc('feed_list_comments', {
    p_post_id: postId,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: PostComment[] } | null)?.items ?? []) as PostComment[]);
}

export async function addComment(input: {
  postId: string;
  body: string;
  parentId?: string | null;
}): Promise<Result<PostComment>> {
  const { data, error } = await supabase.rpc('feed_add_comment', {
    p_post_id: input.postId,
    p_body: input.body,
    p_parent: input.parentId ?? null,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as PostComment);
}

export async function deleteComment(commentId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('feed_delete_comment', { p_comment_id: commentId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function fetchProfilePosts(params: {
  username: string;
  kind?: 'posts' | 'media' | 'news';
  limit?: number;
  offset?: number;
}): Promise<Result<FeedPost[]>> {
  const { data, error } = await supabase.rpc('feed_profile_posts', {
    p_username: params.username,
    p_kind: params.kind ?? 'posts',
    p_limit: params.limit ?? 18,
    p_offset: params.offset ?? 0,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: FeedPost[] } | null)?.items ?? []) as FeedPost[]);
}
