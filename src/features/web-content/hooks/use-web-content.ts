import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Result } from '@/utils/result';

import * as web from '../services/web-content-service';
import type {
  AdminContactChannel,
  ContactChannel,
  ContactSubmission,
  ContactTopic,
  EmailLogs,
  WebsiteContent,
} from '../types';

export const webContentKeys = {
  content: ['website', 'content'] as const,
  channels: ['website', 'contact-channels'] as const,
  adminContent: ['website', 'admin', 'content'] as const,
  adminChannels: ['website', 'admin', 'channels'] as const,
  adminSubmissions: (status: string | null) => ['website', 'admin', 'submissions', status] as const,
  emailLogs: ['website', 'admin', 'email-logs'] as const,
};

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
};

export function useWebsiteContent() {
  return useQuery<WebsiteContent, Error>({
    queryKey: webContentKeys.content,
    queryFn: async () => unwrap(await web.fetchWebsiteContent()),
    staleTime: 5 * 60_000,
  });
}

export function useContactChannels() {
  return useQuery<ContactChannel[], Error>({
    queryKey: webContentKeys.channels,
    queryFn: async () => unwrap(await web.fetchContactChannels()),
    staleTime: 10 * 60_000,
  });
}

export function useSubmitContact() {
  return useMutation({
    mutationFn: async (input: {
      name: string;
      email: string;
      topic: ContactTopic;
      message: string;
    }) => unwrap(await web.submitContact(input)),
  });
}

export function useAdminWebsiteContent() {
  return useQuery<WebsiteContent, Error>({
    queryKey: webContentKeys.adminContent,
    queryFn: async () => unwrap(await web.adminFetchWebsiteContent()),
    staleTime: 30_000,
  });
}

export function useAdminSaveWebsiteSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; value: Record<string, unknown> }) =>
      unwrap(await web.adminSaveWebsiteSetting(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['website'] });
    },
  });
}

export function useAdminSaveWebsiteSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof web.adminSaveWebsiteSection>[0]) =>
      unwrap(await web.adminSaveWebsiteSection(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['website'] });
    },
  });
}

export function useAdminContactChannels() {
  return useQuery<AdminContactChannel[], Error>({
    queryKey: webContentKeys.adminChannels,
    queryFn: async () => unwrap(await web.adminFetchContactChannels()),
    staleTime: 30_000,
  });
}

export function useAdminSaveContactChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof web.adminSaveContactChannel>[0]) =>
      unwrap(await web.adminSaveContactChannel(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['website'] });
    },
  });
}

export function useAdminContactSubmissions(status: string | null = null) {
  return useQuery<ContactSubmission[], Error>({
    queryKey: webContentKeys.adminSubmissions(status),
    queryFn: async () => unwrap(await web.adminFetchContactSubmissions(status)),
    staleTime: 20_000,
  });
}

export function useAdminUpdateContactSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: 'received' | 'in_review' | 'answered' | 'closed' | 'spam';
      response?: string | null;
    }) => unwrap(await web.adminUpdateContactSubmission(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['website', 'admin', 'submissions'] });
    },
  });
}

export function useAdminEmailLogs() {
  return useQuery<EmailLogs, Error>({
    queryKey: webContentKeys.emailLogs,
    queryFn: async () => unwrap(await web.adminFetchEmailLogs()),
    staleTime: 30_000,
  });
}
