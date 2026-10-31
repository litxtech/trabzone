/**
 * Yolculuk başlatma penceresi.
 *
 * Sunucu `ride_offer_start` yalnızca kalkıştan 30 dakika önce ve sonrasında
 * başlatmaya izin verir. Arayüz aynı kuralı gösterir; asıl doğrulama her
 * zaman sunucudadır.
 */
export const START_LEAD_MINUTES = 30;

export type StartAvailability = {
  canStart: boolean;
  opensAt: Date | null;
  minutesUntilOpen: number;
  label: string;
};

export function getStartAvailability(
  departAt: string | null | undefined,
  now: number = Date.now(),
): StartAvailability {
  if (!departAt) {
    return { canStart: false, opensAt: null, minutesUntilOpen: 0, label: 'Kalkış saati yok' };
  }
  const depart = new Date(departAt);
  if (Number.isNaN(depart.getTime())) {
    return { canStart: false, opensAt: null, minutesUntilOpen: 0, label: 'Kalkış saati geçersiz' };
  }
  const opensAt = new Date(depart.getTime() - START_LEAD_MINUTES * 60_000);
  const diff = opensAt.getTime() - now;
  if (diff <= 0) {
    return { canStart: true, opensAt, minutesUntilOpen: 0, label: 'Yolculuk başlatılabilir' };
  }
  const minutes = Math.ceil(diff / 60_000);
  const label =
    minutes >= 60
      ? `${Math.floor(minutes / 60)} sa ${minutes % 60} dk sonra başlatılabilir`
      : `${minutes} dk sonra başlatılabilir`;
  return { canStart: false, opensAt, minutesUntilOpen: minutes, label };
}

/** Sunucudan gelen başlatma hatasını kullanıcıya daha açık anlatır. */
export function startRideErrorMessage(message: string | null | undefined, fallback: string): string {
  const value = String(message ?? '');
  if (/too_early_to_start|çok erken/i.test(value)) {
    return `Yolculuk kalkıştan ${START_LEAD_MINUTES} dakika önce başlatılabilir. Kalkış saatine yakın tekrar dene.`;
  }
  if (/verification_required|kimlik doğrulaman/i.test(value)) {
    return 'Yolculuğu başlatmak için kimlik, sürücü belgesi ve araç doğrulamaların onaylı olmalı.';
  }
  if (/not_allowed|yetkin yok/i.test(value)) {
    return 'Bu yolculuğu yalnızca ilanın yetkili sürücüsü başlatabilir.';
  }
  if (/invalid_transition|bu durumda/i.test(value)) {
    return 'Yolculuk bu durumda başlatılamaz. İlan iptal edilmiş veya tamamlanmış olabilir.';
  }
  return message || fallback;
}
