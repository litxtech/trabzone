import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import {
  accountDeletionKeys,
  fetchDeletionStatus,
  removeDeletionMedia,
  requestAccountDeletion,
  type DeletionReceipt,
} from '../services/account-deletion-service';

export function useDeletionStatus() {
  return useQuery({
    queryKey: accountDeletionKeys.status,
    queryFn: () => unwrap(fetchDeletionStatus()),
    staleTime: 30_000,
  });
}

export type DeleteAccountInput = {
  confirm: string;
  password?: string | null;
  reason?: string | null;
};

/**
 * Hesabi siler: once medya dosyalari Storage API ile temizlenir, sonra
 * `account_delete_self` cagrilir. Sunucu istegi reddederse (sifre hatasi,
 * kalan medya, son yonetici) hicbir sey silinmez. Oturum kapatma makbuz
 * ekranindan sonra yapilir.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();

  return useMutation<DeletionReceipt, Error, DeleteAccountInput>({
    mutationFn: async (input) => {
      const media = await removeDeletionMedia();
      if (!media.ok) {
        throw media.error;
      }
      const receipt = await requestAccountDeletion(input);
      if (!receipt.ok) {
        throw receipt.error;
      }
      return receipt.data;
    },
    onSuccess: () => {
      // Hesap sunucuda silindi; onbellekteki kullanici verileri artik gecersiz.
      // Oturum kapatma, makbuz ekrani goruntulendikten sonra ekran tarafindan
      // yapilir (AuthGate'in ekrani hemen degistirmemesi icin).
      queryClient.clear();
    },
  });
}
