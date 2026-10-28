import { Alert, Platform, type AlertButton, type AlertOptions } from 'react-native';

type AlertHost = {
  alert: (title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) => void;
  __trabzoneWebAlert?: boolean;
};

function buildMessage(title: string, message?: string) {
  return [title, message].filter((part) => Boolean(part && String(part).trim())).join('\n\n');
}

/**
 * Web'de `react-native-web`'in `Alert.alert` uygulaması boş bir fonksiyondur:
 * çağrı sessizce yutulur, kullanıcı hiçbir şey görmez. Bu yüzden "İlanı sil"
 * gibi onay isteyen akışlar web'de hiç çalışmıyordu.
 *
 * Aşağıdaki yama, `Alert.alert` çağrılarını tarayıcının kendi diyaloglarına
 * çevirir. Böylece uygulamadaki tüm onay/bilgi çağrıları web'de de davranış
 * kazanır; ekran ekran değişiklik gerekmez.
 */
export function installWebAlertFallback(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return;
  }

  const host = Alert as unknown as AlertHost;
  if (host.__trabzoneWebAlert) {
    return;
  }

  host.alert = (title, message, buttons, options) => {
    const text = buildMessage(title, message);
    const list = (buttons ?? []).filter(Boolean);

    // Yalnızca bilgi veren çağrılar (buton yok veya tek "Tamam").
    const actionable = list.filter((button) => button.style !== 'cancel');
    if (actionable.length === 0) {
      if (text) {
        window.alert(text);
      }
      const dismiss = list[0]?.onPress;
      dismiss?.();
      options?.onDismiss?.();
      return;
    }

    if (actionable.length === 1 && list.length === 1) {
      if (text) {
        window.alert(text);
      }
      actionable[0]?.onPress?.();
      options?.onDismiss?.();
      return;
    }

    // Birden fazla seçenek: son eylem birincil kabul edilir (RN'de de
    // genellikle onay butonu en sonda tanımlanır), iptal ayrıca aranır.
    const primary = actionable[actionable.length - 1];
    const cancel =
      list.find((button) => button.style === 'cancel') ??
      list.find((button) => button !== primary) ??
      null;

    const accepted = window.confirm(text);
    if (accepted) {
      primary?.onPress?.();
    } else {
      cancel?.onPress?.();
    }
    options?.onDismiss?.();
  };

  host.__trabzoneWebAlert = true;
}
