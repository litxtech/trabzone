import { Redirect } from 'expo-router';
import type { PropsWithChildren } from 'react';

import { useAuthStatus } from '@/stores/auth-store';

import { useLegalRealtime, usePendingAcceptances } from '../hooks/use-legal';

/**
 * Oturum açmış kullanıcıyı, kabul etmesi gereken güncel sözleşme varsa
 * onay ekranına yönlendirir. Sorgu hata verirse kullanıcıyı kilitlememek
 * için normal akış devam eder; kabul kaydı sunucuda ayrıca doğrulanır.
 *
 * Yeni bir sözleşme sürümü yayınlandığında realtime aboneliği bekleyen
 * listesini tazeler, kullanıcı sayfayı yenilemek zorunda kalmaz.
 */
export function LegalConsentGate({ children }: PropsWithChildren) {
  const status = useAuthStatus();
  const authenticated = status === 'authenticated';
  useLegalRealtime(authenticated);
  const { data: pending, isLoading, isError } = usePendingAcceptances(authenticated);

  if (status === 'booting' || isLoading || isError) {
    return children;
  }

  if ((pending?.length ?? 0) > 0) {
    return <Redirect href="/legal/consent" />;
  }

  return children;
}
