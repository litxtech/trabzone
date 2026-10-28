import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteTrack,
  type TrackPublication,
} from 'livekit-client';
import {
  createElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { StyleSheet, View } from 'react-native';

import { INITIAL_CALL_MEDIA_STATE, type CallMediaHandle, type CallMediaProps } from './call-media-types';

/**
 * Web görüşme katmanı: `livekit-client` doğrudan kullanılır, video elemanları
 * tarayıcının kendi <video> etiketiyle çizilir. Native modül (WebRTC köprüsü)
 * web paketine hiç girmez.
 */
export const CallMedia = forwardRef<CallMediaHandle, CallMediaProps>(function CallMedia(
  { serverUrl, token, video, onStateChange },
  ref,
) {
  const stateCallback = useRef(onStateChange);
  useEffect(() => {
    stateCallback.current = onStateChange;
  }, [onStateChange]);

  const roomRef = useRef<Room | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioElements = useRef<HTMLMediaElement[]>([]);
  const errorRef = useRef<string | null>(null);

  const emitState = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      return;
    }
    const remoteParticipants = [...room.remoteParticipants.values()];
    stateCallback.current({
      ...INITIAL_CALL_MEDIA_STATE,
      connected: room.state === ConnectionState.Connected,
      micEnabled: room.localParticipant.isMicrophoneEnabled,
      cameraEnabled: room.localParticipant.isCameraEnabled,
      remoteCameraEnabled: remoteParticipants.some((participant) => {
        const publication = participant.getTrackPublication(Track.Source.Camera);
        return Boolean(publication?.isSubscribed && !publication.isMuted);
      }),
      participantCount: remoteParticipants.length + 1,
      error: errorRef.current,
    });
  }, []);

  useEffect(() => {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    let disposed = false;

    const attachRemote = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video) {
        if (remoteVideoRef.current) {
          track.attach(remoteVideoRef.current);
        }
      } else if (track.kind === Track.Kind.Audio) {
        // Ses, gizli bir DOM elemanına bağlanır; tarayıcı politikası
        // kullanıcı dokunuşuyla açılan bağlantıda otomatik oynatmaya izin verir.
        const element = track.attach();
        element.autoplay = true;
        element.style.display = 'none';
        document.body.appendChild(element);
        audioElements.current.push(element);
      }
      emitState();
    };

    const detachRemote = (track: RemoteTrack) => {
      for (const element of track.detach()) {
        element.remove();
      }
      emitState();
    };

    const attachLocal = (publication: LocalTrackPublication) => {
      if (publication.source === Track.Source.Camera && localVideoRef.current) {
        const track = publication.videoTrack ?? publication.track;
        track?.attach(localVideoRef.current);
      }
      emitState();
    };

    const detachLocal = (publication: LocalTrackPublication) => {
      if (publication.source === Track.Source.Camera) {
        for (const element of publication.track?.detach() ?? []) {
          element.remove();
        }
      }
      emitState();
    };

    // Karşı taraf kamerasını kapatınca son kare donuk kalmasın.
    const handleTrackMuted = (publication: TrackPublication) => {
      if (publication.source === Track.Source.Camera && !publication.isLocal) {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
      }
      emitState();
    };

    const handleTrackUnmuted = (publication: TrackPublication) => {
      if (publication.source === Track.Source.Camera && publication.track) {
        const element = publication.isLocal ? localVideoRef.current : remoteVideoRef.current;
        if (element) {
          publication.track.attach(element);
        }
      }
      emitState();
    };

    // Tarayıcılar ses oynatmayı kullanıcı etkileşimine bağlar. Bağlantı
    // kurulana kadar ilk dokunuşta ses kilidi açılmaya çalışılır.
    const unlockAudio = () => {
      void room
        .startAudio()
        .then(() => {
          document.removeEventListener('pointerdown', unlockAudio);
        })
        .catch(() => undefined);
    };
    document.addEventListener('pointerdown', unlockAudio);

    room
      .on(RoomEvent.TrackSubscribed, attachRemote)
      .on(RoomEvent.TrackUnsubscribed, detachRemote)
      .on(RoomEvent.TrackMuted, handleTrackMuted)
      .on(RoomEvent.TrackUnmuted, handleTrackUnmuted)
      .on(RoomEvent.LocalTrackPublished, attachLocal)
      .on(RoomEvent.LocalTrackUnpublished, detachLocal)
      .on(RoomEvent.ParticipantConnected, emitState)
      .on(RoomEvent.ParticipantDisconnected, emitState)
      .on(RoomEvent.ConnectionStateChanged, emitState)
      .on(RoomEvent.Disconnected, () => {
        errorRef.current = null;
        emitState();
      });

    const connect = async () => {
      try {
        await room.connect(serverUrl, token, { autoSubscribe: true });
        if (disposed) {
          return;
        }
        await room.startAudio().catch(() => undefined);
        await room.localParticipant.setMicrophoneEnabled(true);
        if (video) {
          await room.localParticipant.setCameraEnabled(true);
        }
      } catch (error) {
        if (disposed) {
          return;
        }
        errorRef.current =
          error instanceof Error ? error.message : 'Görüşmeye bağlanılamadı.';
      }
      emitState();
    };

    void connect();

    return () => {
      disposed = true;
      document.removeEventListener('pointerdown', unlockAudio);
      room.removeAllListeners();
      for (const element of audioElements.current) {
        element.remove();
      }
      audioElements.current = [];
      roomRef.current = null;
      void room.disconnect();
    };
  }, [serverUrl, token, video, emitState]);

  useImperativeHandle(
    ref,
    () => ({
      setMicrophoneEnabled: async (enabled: boolean) => {
        await roomRef.current?.localParticipant.setMicrophoneEnabled(enabled);
        emitState();
      },
      setCameraEnabled: async (enabled: boolean) => {
        await roomRef.current?.localParticipant.setCameraEnabled(enabled);
        emitState();
      },
      disconnect: async () => {
        await roomRef.current?.disconnect();
      },
    }),
    [emitState],
  );

  return (
    <View style={styles.stage} pointerEvents="none">
      {createElement('video', {
        ref: remoteVideoRef,
        autoPlay: true,
        playsInline: true,
        // Ses ayrı bir elemanla çalınır; görüntü öğesi sessiz kalarak
        // tarayıcının otomatik oynatma kısıtına takılmaz.
        muted: true,
        style: remoteVideoStyle,
      })}
      {video
        ? createElement('video', {
            ref: localVideoRef,
            autoPlay: true,
            playsInline: true,
            muted: true,
            style: localVideoStyle,
          })
        : null}
    </View>
  );
});

const styles = StyleSheet.create({
  stage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});

const remoteVideoStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  backgroundColor: 'transparent',
};

const localVideoStyle: React.CSSProperties = {
  position: 'absolute',
  right: 16,
  top: 92,
  width: 104,
  height: 148,
  borderRadius: 16,
  objectFit: 'cover',
  backgroundColor: '#141B2E',
  transform: 'scaleX(-1)',
};
