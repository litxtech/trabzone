import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createStory,
  deleteStory,
  fetchStoriesForUser,
  fetchStoryFeed,
  fetchStoryViewers,
  markStoryViewed,
} from '../services/stories-service';
import { feedQueryKeys } from '../services/feed-service';
import { unwrap } from '@/utils/result';

export function useStoryFeed() {
  return useQuery({
    queryKey: feedQueryKeys.storyFeed,
    queryFn: () => unwrap(fetchStoryFeed()),
    staleTime: 30_000,
  });
}

export function useStoriesForUser(userId: string | null) {
  return useQuery({
    queryKey: feedQueryKeys.storyUser(userId ?? 'none'),
    queryFn: () => unwrap(fetchStoriesForUser(userId as string)),
    enabled: Boolean(userId),
    staleTime: 30_000,
  });
}

export function useStoryViewers(storyId: string | null) {
  return useQuery({
    queryKey: feedQueryKeys.storyViewers(storyId ?? 'none'),
    queryFn: () => unwrap(fetchStoryViewers(storyId as string)),
    enabled: Boolean(storyId),
    staleTime: 20_000,
  });
}

export function useCreateStory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { mediaPath: string; mediaType: 'image' | 'video'; caption: string | null }) =>
      unwrap(createStory(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedQueryKeys.storyFeed });
      void queryClient.invalidateQueries({ queryKey: ['stories'] });
    },
  });
}

export function useDeleteStory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (storyId: string) => unwrap(deleteStory(storyId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stories'] });
    },
  });
}

export function useMarkStoryViewed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (storyId: string) => unwrap(markStoryViewed(storyId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedQueryKeys.storyFeed });
      void queryClient.invalidateQueries({ queryKey: ['stories', 'user'] });
    },
  });
}
