import { forwardRef, useCallback, useEffect, useImperativeHandle } from 'react';
import { Platform } from 'react-native';

import {
  INITIAL_CALL_MEDIA_STATE,
  type CallMediaHandle,
  type CallMediaProps,
  type CallMediaState,
} from './call-media-types';

type LiveKitCallMediaModule = typeof import('./CallMedia.livekit');

const UNAVAILABLE_MESSAGE =
  'Görüşme bu derlemede desteklenmiyor. Ses ve görüntü için development build (expo-dev-client) gerekiyor.';

/**
 * Gerçek LiveKit katmanını tembel ve güvenli biçimde yükler.
 *
 * `@livekit/react-native` native WebRTC köprüsünü (AudioDeviceModule üzerinden
 * `new NativeEventEmitter()`) modül değerlendirilirken kurar ve derlemede native
 * modül yoksa (Expo Go, simülatör, yalnızca JS içeren build) **senkron** olarak
 * fırlatır. Statik `import` bu hatayı bundle değerlendirmesine taşır: bu bileşeni
 * içe aktaran `(app)/call/[id].tsx` rotası varsayılan export'unu hiçbir zaman
 * tamamlayamaz ve yönlendirici "Route is missing the required default export"
 * uyarısıyla aramayı tamamen kaybeder. Senkron `require` fırlatmayı normal
 * try/catch ile yakalanabilir kılar; modül yoksa geri düşüş bileşeni gösterilir
 * ve arama ekranının geri kalanı (sinyalleşme, kapatma, durum) çalışmaya devam eder.
 */
let livekitModule: LiveKitCallMediaModule | null | undefined;

function loadLiveKitCallMedia(): LiveKitCallMediaModule | null {
  if (Platform.OS === 'web') {
    return null;
  }
  if (livekitModule !== undefined) {
    return livekitModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native modul yoksa statik import bundle'i cokertiyor
    livekitModule = require('./CallMedia.livekit') as LiveKitCallMediaModule;
  } catch {
    if (__DEV__) {
      console.warn(
        '[CallMedia] @livekit/react-native yuklenemedi; sesli/goruntulu gorusme bu derlemede devre disi. Development build (expo-dev-client) gerekiyor.',
      );
    }
    livekitModule = null;
  }
  return livekitModule;
}

/**
 * Native görüşme katmanı girişi.
 *
 * LiveKit native modülü varsa gerçek görüşme bileşeni, yoksa arama ekranını
 * çökertmeyen bilgilendirici geri düşüş çizilir.
 */
export const CallMedia = forwardRef<CallMediaHandle, CallMediaProps>(function CallMedia(props, ref) {
  const livekit = loadLiveKitCallMedia();
  if (livekit) {
    const LiveKitCallMedia = livekit.CallMedia;
    return <LiveKitCallMedia {...props} ref={ref} />;
  }
  return <UnsupportedCallMedia {...props} ref={ref} />;
});

/**
 * Native WebRTC derlemede yokken kullanılan geri düşüş.
 *
 * Görsel katman çizmez; arama ekranı `error` alanını bildirim olarak gösterir.
 * Tutamaç metotları sessizce başarısız olur ki mikrofon/kamera düğmeleri
 * aramayı kilitlemesin.
 */
const UnsupportedCallMedia = forwardRef<CallMediaHandle, CallMediaProps>(
  function UnsupportedCallMedia({ onStateChange }, ref) {
    const handleState = useCallback(
      (next: CallMediaState) => {
        onStateChange(next);
      },
      [onStateChange],
    );

    useEffect(() => {
      handleState({
        ...INITIAL_CALL_MEDIA_STATE,
        micEnabled: false,
        cameraEnabled: false,
        error: UNAVAILABLE_MESSAGE,
      });
    }, [handleState]);

    useImperativeHandle(
      ref,
      () => ({
        setMicrophoneEnabled: async () => undefined,
        setCameraEnabled: async () => undefined,
        disconnect: async () => undefined,
      }),
      [],
    );

    return null;
  },
);
