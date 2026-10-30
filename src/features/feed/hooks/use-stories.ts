import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createStory,
  deleteStory,
  fetchStoriesForUser,
  fetchStoryFeed,
  fetchStoryViewers,
  markStoryViewed,
  type StoryGroup,
} from '../services/stories-service';
import { feedQueryKeys } from '../services/feed-service';
import { unwrap } from '@/utils/result';

/**
 * Silinen hikâyeyi önbellekten düşürür. Sunucu tarafı silme başarılı olduğunda
 * yeniden çekme tamamlanana kadar şeritte/izleyicide eski hikâye görünmesin.
 */
function pruneStoryFromGroup(group: StoryGroup, storyId: string): StoryGroup | null {
  if (!group.items.some((item) => item.id === storyId)) {
    return group;
  }
  const items = group.items.filter((item) => item.id !== storyId);
  return items.length === 0 ? null : { ...group, items };
}

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
    onSuccess: (_data, storyId) => {
      // Devam eden yeniden çekmeler eski listeyi geri yazmasın.
      void queryClient.cancelQueries({ queryKey: ['stories'] });
      // İyimser temizlik: yanıt yeniden çekilmeden önce hikâye şeritten düşsün.
      queryClient.setQueriesData<StoryGroup[]>({ queryKey: feedQueryKeys.storyFeed }, (groups) => {
        if (!groups) return groups;
        return groups
          .map((group) => pruneStoryFromGroup(group, storyId))
          .filter((group): group is StoryGroup => group !== null);
      });
      queryClient.setQueriesData<StoryGroup | null>({ queryKey: ['stories', 'user'] }, (group) =>
        group ? pruneStoryFromGroup(group, storyId) : group,
      );
      queryClient.removeQueries({ queryKey: feedQueryKeys.storyViewers(storyId) });
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
