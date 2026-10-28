import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  isTrackReference,
  registerGlobals,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/react-native';
import { Room, Track } from 'livekit-client';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';

import {
  INITIAL_CALL_MEDIA_STATE,
  type CallMediaHandle,
  type CallMediaProps,
  type CallMediaState,
} from './call-media-types';

// WebRTC köprüsü (RTCPeerConnection, mediaDevices, ...) LiveKit'e bağlanmadan
// önce kurulmalı. Modül yüklenirken bir kez çalışır.
registerGlobals();

/**
 * Gerçek native görüşme katmanı: `@livekit/react-native` + native WebRTC.
 *
 * Bu dosya **doğrudan** import edilmez. `@livekit/react-native` native WebRTC
 * köprüsünü modül yüklenirken kurar ve derlemede native modül yoksa senkron
 * olarak fırlatır; bu yüzden yalnızca `CallMedia.native.tsx` içindeki korumalı
 * `require` üzerinden, native modülün varlığı doğrulandıktan sonra yüklenir.
 */
export const CallMedia = forwardRef<CallMediaHandle, CallMediaProps>(function CallMedia(
  { serverUrl, token, video, onStateChange },
  ref,
) {
  const handleState = useCallback(
    (next: CallMediaState) => {
      onStateChange(next);
    },
    [onStateChange],
  );

  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const room = useMemo(
    () =>
      new Room({
        adaptiveStream: { pixelDensity: 'screen' },
        dynacast: true,
      }),
    [],
  );

  // Hoparlör/kulaklık yönlendirmesi ve ses oturumu bağlantıdan önce açılır.
  useEffect(() => {
    void AudioSession.startAudioSession().catch(() => undefined);
    return () => {
      void AudioSession.stopAudioSession().catch(() => undefined);
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setMicrophoneEnabled: async (enabled: boolean) => {
        await room.localParticipant.setMicrophoneEnabled(enabled);
      },
      setCameraEnabled: async (enabled: boolean) => {
        await room.localParticipant.setCameraEnabled(enabled);
      },
      disconnect: async () => {
        await room.disconnect();
      },
    }),
    [room],
  );

  return (
    <LiveKitRoom
      room={room}
      serverUrl={serverUrl}
      token={token}
      connect
      audio
      video={video}
      onConnected={() => setConnected(true)}
      onDisconnected={() => setConnected(false)}
      onError={(mediaError) => {
        setError(mediaError.message);
      }}
    >
      <CallStage
        video={video}
        connected={connected}
        error={error}
        onStateChange={handleState}
      />
    </LiveKitRoom>
  );
});

function CallStage({
  video,
  connected,
  error,
  onStateChange,
}: {
  video: boolean;
  connected: boolean;
  error: string | null;
  onStateChange: (state: CallMediaState) => void;
}) {
  const room = useRoomContext();
  const participants = useParticipants();
  const { isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const cameraTracks = useTracks([Track.Source.Camera]);

  // Susturulmuş (kapatılmış) kamera yayınları son kareyi dondurmasın diye
  // yalnızca etkin ve abone olunmuş izler çizilir.
  const activeCameraTracks = cameraTracks.filter(
    (track) => isTrackReference(track) && !track.publication.isMuted,
  );

  const local = activeCameraTracks.find(
    (track) => isTrackReference(track) && track.participant.identity === room.localParticipant.identity,
  );
  const remote = activeCameraTracks.find(
    (track) => isTrackReference(track) && track.participant.identity !== room.localParticipant.identity,
  );

  const remoteCameraEnabled = Boolean(remote);

  useEffect(() => {
    onStateChange({
      ...INITIAL_CALL_MEDIA_STATE,
      connected,
      micEnabled: isMicrophoneEnabled,
      cameraEnabled: isCameraEnabled,
      remoteCameraEnabled,
      participantCount: participants.length,
      error,
    });
  }, [
    connected,
    isMicrophoneEnabled,
    isCameraEnabled,
    remoteCameraEnabled,
    participants.length,
    error,
    onStateChange,
  ]);

  return (
    <View style={styles.stage} pointerEvents="none">
      {remote && isTrackReference(remote) ? (
        <VideoTrack trackRef={remote} style={styles.remote} objectFit="cover" />
      ) : null}
      {video && local && isTrackReference(local) ? (
        <VideoTrack trackRef={local} style={styles.local} objectFit="cover" mirror zOrder={1} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  remote: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  local: {
    position: 'absolute',
    right: 16,
    top: 92,
    width: 104,
    height: 148,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#141B2E',
  },
});
