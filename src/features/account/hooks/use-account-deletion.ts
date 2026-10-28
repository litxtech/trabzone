import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import {
  accountDeletionKeys,
  deleteAccountCompletely,
  fetchDeletionStatus,
  type DeletionReceipt,
  type DeletionStep,
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
 * Hesabı siler.
 *
 * Akış: doğrulama (şifre/onay) → Apple oturum jetonunun geri alınması → medya
 * temizliği (R2 + eski Storage nesneleri) → hesabın kalıcı olarak silinmesi.
 * Doğrulama başarısız olursa hiçbir veri kaldırılmaz; medya temizliği
 * başarısız olursa hesap silinmez. Oturum kapatma makbuz ekranından sonra
 * yapılır.
 *
 * `onStep` ile ekran, işlemin hangi adımda olduğunu gösterebilir.
 */
export function useDeleteAccount(onStep?: (step: DeletionStep) => void) {
  const queryClient = useQueryClient();

  return useMutation<DeletionReceipt, Error, DeleteAccountInput>({
    mutationFn: async (input) => unwrap(deleteAccountCompletely(input, onStep)),
    onSuccess: () => {
      // Hesap sunucuda silindi; onbellekteki kullanici verileri artik gecersiz.
      // Oturum kapatma, makbuz ekrani goruntulendikten sonra ekran tarafindan
      // yapilir (AuthGate'in ekrani hemen degistirmemesi icin).
      queryClient.clear();
    },
  });
}
