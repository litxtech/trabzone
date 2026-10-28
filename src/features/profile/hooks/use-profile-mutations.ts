import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/stores/auth-store';

import {
  changeUsername,
  fetchMyPrivacySettings,
  fetchUsernameChangeStatus,
  updateMyPrivacySettings,
  updateMyProfile,
  type PrivacySettings,
  type Profile,
  type ProfilePatch,
  type UsernameChangeStatus,
} from '../services/profile-service';
import { deleteProfileMedia, uploadProfileMedia, type MediaKind } from '../services/media-service';
import { blockUser, unblockUser } from '../services/social-service';
import { profileQueryKeys } from './use-my-profile';

export function useMyPrivacySettings() {
  return useQuery<PrivacySettings | null>({
    queryKey: ['my-privacy-settings'],
    queryFn: async () => {
      const result = await fetchMyPrivacySettings();
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    staleTime: 60_000,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation<Profile, Error, ProfilePatch>({
    mutationFn: async (patch) => {
      const result = await updateMyProfile(patch);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(profileQueryKeys.me, profile);
      void queryClient.invalidateQueries({ queryKey: profileQueryKeys.me });
      void queryClient.invalidateQueries({ queryKey: ['profile-view'] });
      void queryClient.invalidateQueries({ queryKey: ['social', 'suggested'] });
    },
  });
}

export function useUsernameChangeStatus() {
  return useQuery<UsernameChangeStatus>({
    queryKey: ['username-change-status'],
    queryFn: async () => {
      const result = await fetchUsernameChangeStatus();
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    staleTime: 30_000,
  });
}

export function useChangeUsername() {
  const queryClient = useQueryClient();
  return useMutation<UsernameChangeStatus, Error, string>({
    mutationFn: async (username) => {
      const result = await changeUsername(username);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['username-change-status'] });
      void queryClient.invalidateQueries({ queryKey: profileQueryKeys.me });
      void queryClient.invalidateQueries({ queryKey: ['profile-view'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

export function useUpdatePrivacySettings() {
  const queryClient = useQueryClient();
  return useMutation<PrivacySettings, Error, Partial<PrivacySettings>>({
    mutationFn: async (patch) => {
      const result = await updateMyPrivacySettings(patch);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(['my-privacy-settings'], settings);
      void queryClient.invalidateQueries({ queryKey: ['profile-view'] });
    },
  });
}

type UploadInput = { kind: MediaKind; uri: string; size?: number; mime?: string };

/**
 * Yukleme + profil guncellemesi tek adimda: yuklenen dosya veritabanina
 * yazilamazsa depodan da silinir, boylece sahipsiz dosya birikmez.
 */
export function useUploadProfileMedia() {
  const queryClient = useQueryClient();
  const session = useSession();

  return useMutation<{ path: string; url: string }, Error, UploadInput>({
    mutationFn: async (input) => {
      const userId = session?.user.id;
      if (!userId) {
        throw new Error('Oturum bulunamadı. Tekrar giriş yap.');
      }

      const uploaded = await uploadProfileMedia({ ...input, userId });
      if (!uploaded.ok) {
        throw new Error(uploaded.error.message);
      }

      const patch: ProfilePatch =
        input.kind === 'avatar'
          ? { avatarPath: uploaded.data.path }
          : { coverPath: uploaded.data.path };

      const saved = await updateMyProfile(patch);
      if (!saved.ok) {
        await deleteProfileMedia(input.kind, uploaded.data.path);
        throw new Error(saved.error.message);
      }

      return uploaded.data;
    },
    onSuccess: (result, variables) => {
      const previous = queryClient.getQueryData<Profile | null>(profileQueryKeys.me);
      if (previous) {
        queryClient.setQueryData<Profile>(profileQueryKeys.me, {
          ...previous,
          avatar_path: variables.kind === 'avatar' ? result.path : previous.avatar_path,
          cover_path: variables.kind === 'cover' ? result.path : previous.cover_path,
        });
      }
      void queryClient.invalidateQueries({ queryKey: profileQueryKeys.me });
      void queryClient.invalidateQueries({ queryKey: ['profile-view'] });
    },
  });
}

export function useRemoveProfileMedia() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { kind: MediaKind; currentPath: string | null }>({
    mutationFn: async ({ kind, currentPath }) => {
      const patch: ProfilePatch =
        kind === 'avatar' ? { avatarPath: null } : { coverPath: null };
      const saved = await updateMyProfile(patch);
      if (!saved.ok) {
        throw new Error(saved.error.message);
      }
      await deleteProfileMedia(kind, currentPath);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileQueryKeys.me });
      void queryClient.invalidateQueries({ queryKey: ['profile-view'] });
    },
  });
}

export function useBlockUser() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (userId) => {
      const result = await blockUser(userId);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile-view'] });
      void queryClient.invalidateQueries({ queryKey: ['social'] });
      void queryClient.invalidateQueries({ queryKey: ['friend-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}

export function useUnblockUser() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (userId) => {
      const result = await unblockUser(userId);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile-view'] });
      void queryClient.invalidateQueries({ queryKey: ['social'] });
    },
  });
}
