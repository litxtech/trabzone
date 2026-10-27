import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  fetchMyAppIcon,
  updateMyAppIcon,
  type AppIconId,
} from '@/features/profile/services/profile-service';

import {
  applyAppIcon,
  readActiveAppIcon,
  supportsAppIconSwitching,
} from '../services/app-icon-service';

export const appIconKeys = { current: ['app-icon'] as const };

export function useAppIcon() {
  const queryClient = useQueryClient();

  const query = useQuery<AppIconId | null>({
    queryKey: appIconKeys.current,
    queryFn: async () => {
      const result = await fetchMyAppIcon();
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    staleTime: 5 * 60_000,
    // The native icon is the truth on this device; the server row only restores
    // the choice after a reinstall.
    initialData: readActiveAppIcon(),
  });

  const mutation = useMutation<AppIconId, Error, AppIconId>({
    mutationFn: async (icon) => {
      await applyAppIcon(icon);
      const saved = await updateMyAppIcon(icon);
      if (!saved.ok) {
        // The device now shows the new icon; keep the UI honest about the
        // server copy failing and let the next app start retry.
        throw new Error(
          'Simge bu cihazda değişti ancak hesabına kaydedilemedi. İnternet bağlantını kontrol et.',
        );
      }
      return saved.data;
    },
    onSuccess: (icon) => {
      queryClient.setQueryData(appIconKeys.current, icon);
    },
  });

  // Re-apply the saved choice on a fresh install.
  useEffect(() => {
    if (!supportsAppIconSwitching()) {
      return;
    }
    const saved = query.data;
    if (!saved) {
      return;
    }
    if (readActiveAppIcon() !== saved) {
      void applyAppIcon(saved).catch(() => undefined);
    }
  }, [query.data]);

  return {
    icon: query.data ?? 'aurora',
    supported: supportsAppIconSwitching(),
    isLoading: query.isLoading,
    setIcon: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
