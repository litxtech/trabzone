import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  NewsAssistAction,
  NewsQueueState,
  NewsReviewAction,
  NewsSettingsProgress,
  NewsSource,
} from '@/features/news/types';
import { unwrap } from '@/utils/result';

import * as news from '../services/news-service';
import { adminNewsKeys } from '../services/news-service';

export function useAdminNewsOverview() {
  return useQuery({
    queryKey: adminNewsKeys.overview,
    queryFn: async () => unwrap(await news.fetchNewsOverview()),
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
}

export function useAdminNewsRuns(limit = 20) {
  return useQuery({
    queryKey: adminNewsKeys.runs(limit),
    queryFn: async () => unwrap(await news.fetchNewsRuns(limit)),
    staleTime: 30_000,
  });
}

export function useAdminNewsSettings() {
  return useQuery({
    queryKey: adminNewsKeys.settings,
    queryFn: async () => unwrap(await news.fetchNewsSettings()),
    staleTime: 30_000,
  });
}

export function useAdminNewsReview(state: NewsQueueState, limit = 25, offset = 0) {
  return useQuery({
    queryKey: adminNewsKeys.review(state, limit, offset),
    queryFn: async () => unwrap(await news.fetchNewsReviewList(state, limit, offset)),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useAdminNewsReviewDetail(eventId: string | null) {
  return useQuery({
    queryKey: adminNewsKeys.reviewDetail(eventId),
    queryFn: async () => unwrap(await news.fetchNewsReviewDetail(eventId as string)),
    enabled: Boolean(eventId),
  });
}

export function useAdminNewsSources() {
  return useQuery({
    queryKey: adminNewsKeys.sources,
    queryFn: async () => unwrap(await news.fetchNewsSources()),
    staleTime: 60_000,
  });
}

export function useAdminNewsCosts() {
  return useQuery({
    queryKey: adminNewsKeys.costs,
    queryFn: async () => unwrap(await news.fetchNewsCosts()),
    staleTime: 60_000,
  });
}

export function useAdminNewsErrors(limit = 30) {
  return useQuery({
    queryKey: adminNewsKeys.errors(limit),
    queryFn: async () => unwrap(await news.fetchNewsErrors(limit)),
    staleTime: 30_000,
  });
}

function useInvalidateNews() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['admin', 'news'] });
    void client.invalidateQueries({ queryKey: ['feed'] });
  };
}

export function useAdminNewsSettingsSave() {
  const invalidate = useInvalidateNews();
  return useMutation({
    mutationFn: async (input: { payload: NewsSettingsProgress; reason?: string | null }) =>
      unwrap(await news.saveNewsSettings(input.payload, input.reason ?? null)),
    onSuccess: invalidate,
  });
}

export function useAdminNewsRunNow() {
  const invalidate = useInvalidateNews();
  return useMutation({
    mutationFn: async () => unwrap(await news.runNewsNow()),
    onSuccess: invalidate,
  });
}

export function useAdminNewsReviewAction() {
  const invalidate = useInvalidateNews();
  return useMutation({
    mutationFn: async (input: {
      eventId: string;
      action: NewsReviewAction;
      payload?: Record<string, unknown>;
      reason?: string | null;
    }) =>
      unwrap(
        await news.reviewNewsEvent(input.eventId, input.action, input.payload ?? {}, input.reason ?? null),
      ),
    onSuccess: invalidate,
  });
}

export function useAdminNewsRetract() {
  const invalidate = useInvalidateNews();
  return useMutation({
    mutationFn: async (input: { eventId: string; reason: string }) =>
      unwrap(await news.retractNewsEvent(input.eventId, input.reason)),
    onSuccess: invalidate,
  });
}

export function useAdminNewsHighRiskPublish() {
  const invalidate = useInvalidateNews();
  return useMutation({
    mutationFn: async (input: { eventId: string; reason: string }) =>
      unwrap(await news.publishHighRiskNews(input.eventId, input.reason)),
    onSuccess: invalidate,
  });
}

export function useAdminNewsSourceSave() {
  const invalidate = useInvalidateNews();
  return useMutation({
    mutationFn: async (input: {
      id: string | null;
      payload: Partial<NewsSource>;
      reason?: string | null;
    }) => unwrap(await news.saveNewsSource(input.id, input.payload, input.reason ?? null)),
    onSuccess: invalidate,
  });
}

export function useAdminNewsSourceToggle() {
  const invalidate = useInvalidateNews();
  return useMutation({
    mutationFn: async (input: { id: string; active: boolean }) =>
      unwrap(await news.toggleNewsSource(input.id, input.active)),
    onSuccess: invalidate,
  });
}

export function useAdminNewsPublisherBind() {
  const invalidate = useInvalidateNews();
  return useMutation({
    mutationFn: async (username: string) => unwrap(await news.bindNewsPublisher(username)),
    onSuccess: invalidate,
  });
}

/** Edge function üzerinden AI düzenleme yardımı; anahtar istemciye inmez. */
export function useAdminNewsAssist() {
  const invalidate = useInvalidateNews();
  return useMutation({
    mutationFn: async (input: {
      action: NewsAssistAction;
      eventId: string;
      payload?: Record<string, unknown>;
    }) => unwrap(await news.invokeNewsAssist(input.action, input.eventId, input.payload ?? {})),
    onSuccess: invalidate,
  });
}

export function useAdminNewsDiagnostics() {
  const invalidate = useInvalidateNews();
  return useMutation({
    mutationFn: async () => unwrap(await news.runNewsDiagnostics()),
    onSuccess: invalidate,
  });
}
