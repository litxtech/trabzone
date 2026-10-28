/** Canlı görüşme katmanının paylaşılan tipleri (native + web). */

export type CallMediaState = {
  /** Sunucuya bağlantı kuruldu mu? */
  connected: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  /** Karşı taraf kamerayı açtı mı? Görüntü katmanını göstermek için kullanılır. */
  remoteCameraEnabled: boolean;
  participantCount: number;
  error: string | null;
};

export type CallMediaHandle = {
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
};

export type CallMediaProps = {
  serverUrl: string;
  token: string;
  /** Görüntülü aramada kamera yayınlanır. */
  video: boolean;
  onStateChange: (state: CallMediaState) => void;
};

export const INITIAL_CALL_MEDIA_STATE: CallMediaState = {
  connected: false,
  micEnabled: true,
  cameraEnabled: true,
  remoteCameraEnabled: false,
  participantCount: 0,
  error: null,
};
