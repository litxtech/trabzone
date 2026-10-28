import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type StoryItem = {
  id: string;
  media_path: string;
  media_type: 'image' | 'video';
  caption: string | null;
  created_at: string;
  expires_at: string;
  viewed: boolean;
  view_count: number | null;
};

export type StoryGroup = {
  author_id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  avatar_path: string | null;
  is_verified: boolean;
  is_me: boolean;
  has_unseen: boolean;
  latest_at: string;
  items: StoryItem[];
};

export type StoryViewer = {
  user_id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  avatar_path: string | null;
  viewed_at: string;
};

export async function fetchStoryFeed(): Promise<Result<StoryGroup[]>> {
  const { data, error } = await supabase.rpc('story_list');
  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: StoryGroup[] } | null)?.items ?? []) as StoryGroup[]);
}

export async function fetchStoriesForUser(userId: string): Promise<Result<StoryGroup | null>> {
  const { data, error } = await supabase.rpc('story_list_for_user', { p_user_id: userId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok((data as StoryGroup | null) ?? null);
}

export async function createStory(input: {
  mediaPath: string;
  mediaType: 'image' | 'video';
  caption: string | null;
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('story_create', {
    p_media_path: input.mediaPath,
    p_media_type: input.mediaType,
    p_caption: input.caption,
  });

  if (error) {
    return fail(rpcError(error));
  }

  const id = (data as { id?: string } | null)?.id;
  return id ? ok(id) : fail(appError('unknown'));
}

export async function markStoryViewed(storyId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('story_mark_viewed', { p_story_id: storyId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function deleteStory(storyId: string): Promise<Result<null>> {
  const { error } = await supabase.rpc('story_delete', { p_story_id: storyId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(null);
}

export async function fetchStoryViewers(storyId: string): Promise<Result<StoryViewer[]>> {
  const { data, error } = await supabase.rpc('story_viewers', { p_story_id: storyId });
  if (error) {
    return fail(rpcError(error));
  }
  return ok(((data as { items?: StoryViewer[] } | null)?.items ?? []) as StoryViewer[]);
}
