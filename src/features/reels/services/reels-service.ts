import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import { publicMediaUrl, removeMedia } from '@/features/media/media-service';

export type Reel = {
  id: string;
  author_id: string;
  author_username: string;
  author_first_name: string | null;
  author_last_name: string | null;
  author_avatar_path: string | null;
  author_is_verified: boolean;
  video_path: string;
  cover_path: string | null;
  caption: string | null;
  audio_title: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  like_count: number;
  comment_count: number;
  save_count: number;
  share_count: number;
  view_count: number;
  status: 'processing' | 'ready' | 'failed';
  is_edited: boolean;
  created_at: string;
  liked: boolean;
  saved: boolean;
  is_mine: boolean;
  following_author: boolean;
};

export type ReelPage = {
  items: Reel[];
  next_cursor: string | null;
  has_more: boolean;
};

export type ReelComment = {
  id: string;
  reel_id: string;
  author_id: string;
  author_username: string;
  author_first_name: string | null;
  author_last_name: string | null;
  author_avatar_path: string | null;
  author_is_verified: boolean;
  body: string;
  created_at: string;
  is_mine: boolean;
  can_delete: boolean;
};

export const reelQueryKeys = {
  feed: ['reels', 'feed'] as const,
  reel: (reelId: string) => ['reels', 'item', reelId] as const,
  user: (username: string) => ['reels', 'user', username.toLowerCase()] as const,
  comments: (reelId: string) => ['reels', 'comments', reelId] as const,
};

export async function fetchReels(params: {
  cursor?: string | null;
  limit?: number;
}): Promise<Result<ReelPage>> {
  const { data, error } = await supabase.rpc('reels_list', {
    p_cursor: params.cursor ?? null,
    p_limit: params.limit ?? 6,
  });

  if (error) {
    return fail(rpcError(error));
  }

  const page = (data ?? {}) as Partial<ReelPage>;
  return ok({
    items: page.items ?? [],
    next_cursor: page.next_cursor ?? null,
    has_more: Boolean(page.has_more),
  });
}

export async function fetchReel(reelId: string): Promise<Result<Reel | null>> {
  const { data, error } = await supabase.rpc('reel_get', { p_reel_id: reelId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok((data as Reel | null) ?? null);
}

export async function fetchUserReels(
  username: string,
  limit = 24,
  offset = 0,
): Promise<Result<Reel[]>> {
  const { data, error } = await supabase.rpc('reels_for_user', {
    p_username: username,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return fail(rpcError(error));
  }

  return ok(((data as { items?: Reel[] } | null)?.items ?? []) as Reel[]);
}

export async function createReel(input: {
  videoPath: string;
  coverPath: string | null;
  caption: string | null;
  audioTitle: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
}): Promise<Result<Reel>> {
  const { data, error } = await supabase.rpc('reel_create', {
    p_video_path: input.videoPath,
    p_cover_path: input.coverPath,
    p_caption: input.caption,
    p_audio_title: input.audioTitle,
    p_duration_ms: input.durationMs,
    p_width: input.width,
    p_height: input.height,
  });

  if (error) {
    return fail(rpcError(error));
  }
  if (!data) {
    return fail(appError('unknown'));
  }
  return ok(data as Reel);
}

export async function updateReel(input: {
  reelId: string;
  caption: string | null;
  coverPath?: string | null;
}): Promise<Result<Reel>> {
  const { data, error } = await supabase.rpc('reel_update', {
    p_reel_id: input.reelId,
    p_caption: input.caption,
    p_cover_path: input.coverPath ?? null,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as Reel);
}

export type DeletedReelPaths = {
  video_path: string | null;
  cover_path: string | null;
};

export async function deleteReel(reelId: string): Promise<Result<DeletedReelPaths>> {
  const { data, error } = await supabase.rpc('reel_delete', { p_reel_id: reelId });
  if (error) {
    return fail(rpcError(error));
  }

  const paths = (data ?? {}) as DeletedReelPaths;
  // Storage temizligi en iyi cabadir; veritabani kaydi silindiyse kullaniciyi
  // teknik bir hata ile bekletmeyiz.
  const files = [paths.video_path, paths.cover_path].filter(
    (path): path is string => Boolean(path),
  );
  if (files.length > 0) {
    await removeMedia('reels', files);
  }

  return ok(paths);
}

export async function toggleReelLike(
  reelId: string,
): Promise<Result<{ liked: boolean; like_count: number }>> {
  const { data, error } = await supabase.rpc('reel_toggle_like', { p_reel_id: reelId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as { liked: boolean; like_count: number });
}

export async function toggleReelSave(
  reelId: string,
): Promise<Result<{ saved: boolean; save_count: number }>> {
  const { data, error } = await supabase.rpc('reel_toggle_save', { p_reel_id: reelId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as { saved: boolean; save_count: number });
}

export async function shareReel(reelId: string): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('reel_share', { p_reel_id: reelId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(Number((data as { share_count?: number } | null)?.share_count ?? 0));
}

export async function registerReelView(reelId: string): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('reel_register_view', { p_reel_id: reelId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(Number((data as { view_count?: number } | null)?.view_count ?? 0));
}

export async function fetchReelComments(reelId: string): Promise<Result<ReelComment[]>> {
  const { data, error } = await supabase.rpc('reel_list_comments', {
    p_reel_id: reelId,
    p_limit: 80,
    p_offset: 0,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: ReelComment[] } | null)?.items ?? []) as ReelComment[]);
}

export async function addReelComment(input: {
  reelId: string;
  body: string;
}): Promise<Result<ReelComment>> {
  const { data, error } = await supabase.rpc('reel_add_comment', {
    p_reel_id: input.reelId,
    p_body: input.body,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as ReelComment);
}

export async function deleteReelComment(commentId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('reel_delete_comment', { p_comment_id: commentId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export function reelUrl(path: string | null | undefined): string | null {
  // R2'ye yüklenen reels medyası da aynı yol biçimini kullanır.
  return publicMediaUrl('reels', path);
}

/** Yayinlama yarida kalirsa yuklenen dosyalari temizler (en iyi caba). */
export async function removeReelUploads(paths: (string | null | undefined)[]): Promise<void> {
  const files = paths.filter((path): path is string => Boolean(path));
  if (files.length === 0) {
    return;
  }
  try {
    await removeMedia('reels', files);
  } catch {
    // Depolama temizligi kullanici akisini engellemez.
  }
}
