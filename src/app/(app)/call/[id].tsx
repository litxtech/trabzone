import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Avatar, IconButton } from '@/components/ui';
import { env } from '@/config/env';
import { CallMedia } from '@/features/calls/components/CallMedia';
import {
  INITIAL_CALL_MEDIA_STATE,
  type CallMediaHandle,
  type CallMediaState,
} from '@/features/calls/components/call-media-types';
import { useCallAccessToken } from '@/features/calls/hooks/use-call-access-token';
import {
  useCall,
  useCallRealtime,
  useEndCall,
  useRespondCall,
} from '@/features/messaging/hooks/use-chat';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

const FINISHED_STATUSES = ['ended', 'declined', 'missed', 'failed'];

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
}

export default function CallScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const callId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const call = useCall(callId || null);
  useCallRealtime(callId || null);
  const respond = useRespondCall(callId);
  const end = useEndCall(callId);

  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  const mediaRef = useRef<CallMediaHandle | null>(null);
  const [media, setMedia] = useState<CallMediaState>(INITIAL_CALL_MEDIA_STATE);

  const data = call.data;
  const active = data?.status === 'accepted';
  const finished = data ? FINISHED_STATUSES.includes(data.status) : false;
  const video = data?.kind === 'video';

  const accessToken = useCallAccessToken(callId || null, active && !finished);

  useEffect(() => {
    if (!active) {
      return;
    }
    if (!startedAt.current) {
      startedAt.current = data?.started_at ? new Date(data.started_at).getTime() : Date.now();
    }
    const update = () => {
      const base = startedAt.current ?? Date.now();
      setElapsed(Math.max(0, Math.floor((Date.now() - base) / 1000)));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [active, data?.started_at]);

  // Karşı taraf kapatınca medya bağlantısı da hemen kesilir.
  useEffect(() => {
    if (finished) {
      void mediaRef.current?.disconnect();
    }
  }, [finished]);

  const peerName = useMemo(() => {
    if (!data) {
      return 'Arama';
    }
    return (
      `${data.peer_first_name ?? ''} ${data.peer_last_name ?? ''}`.trim() || data.peer_username
    );
  }, [data]);

  const close = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/messages');
    }
  };

  const hangUp = () => {
    haptics.press();
    void mediaRef.current?.disconnect();
    end.mutate(undefined, {
      onSettled: () => close(),
    });
  };

  const respondToCall = (accept: boolean) => {
    haptics.selection();
    respond.mutate(accept, {
      onError: (error) => Alert.alert('Arama yanıtlanamadı', error.message),
    });
  };

  const toggleMic = () => {
    haptics.selection();
    void mediaRef.current?.setMicrophoneEnabled(!media.micEnabled);
  };

  const toggleCamera = () => {
    haptics.selection();
    void mediaRef.current?.setCameraEnabled(!media.cameraEnabled);
  };

  if (call.isLoading || !data) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator color="#FFFFFF" />
        {call.isError ? (
          <>
            <AppText variant="body" color="#D7DEEF" align="center">
              Arama bulunamadı veya sona erdi.
            </AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="Kapat" onPress={close}>
              <AppText variant="label" color="#FFFFFF">
                Kapat
              </AppText>
            </Pressable>
          </>
        ) : null}
      </View>
    );
  }

  const incoming = !data.is_caller && data.status === 'ringing';
  const showRemoteVideo = video && media.remoteCameraEnabled;
  const live = Boolean(accessToken.data);

  const statusLabel = finished
    ? data.status === 'declined'
      ? 'Arama reddedildi'
      : data.status === 'missed'
        ? 'Cevapsız arama'
        : 'Arama sona erdi'
    : active
      ? media.connected
        ? formatElapsed(elapsed)
        : 'Bağlanıyor…'
      : incoming
        ? `${video ? 'Görüntülü' : 'Sesli'} arama geliyor`
        : data.is_caller
          ? 'Aranıyor…'
          : 'Bağlanıyor…';

  const mediaMessage = !env.livekitUrl
    ? 'Görüşme sunucusu yapılandırılmamış. Arama sinyalleri çalışıyor, ses/görüntü aktarılamıyor.'
    : accessToken.isError
      ? errorMessage(accessToken.error, 'Görüşmeye bağlanılamadı.')
      : media.error;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#101B38', '#1B2640', '#0B1020']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {live && accessToken.data ? (
        <CallMedia
          ref={mediaRef}
          serverUrl={accessToken.data.url}
          token={accessToken.data.token}
          video={video}
          onStateChange={setMedia}
        />
      ) : null}

      <View
        style={[
          styles.top,
          { paddingTop: insets.top + 14 },
          showRemoteVideo && styles.topScrim,
        ]}
      >
        <View style={[styles.kindPill, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
          <Ionicons
            name={video ? 'videocam-outline' : 'call-outline'}
            size={13}
            color="#E7ECF9"
          />
          <AppText variant="caption" color="#E7ECF9">
            {video ? 'Görüntülü arama' : 'Sesli arama'}
          </AppText>
        </View>

        {showRemoteVideo ? null : (
          <Avatar uri={mediaPublicUrl('avatar', data.peer_avatar_path)} name={peerName} size={128} />
        )}

        <AppText variant="h2" color="#FFFFFF" align="center" numberOfLines={1}>
          {peerName}
        </AppText>
        <AppText variant="body" color="#A2AEC7" align="center">
          @{data.peer_username}
        </AppText>

        <View style={styles.statusRow}>
          {data.status === 'ringing' || (active && !media.connected) ? (
            <View style={styles.pulseDot} />
          ) : null}
          <AppText variant="bodyStrong" color={active ? '#7CE0AE' : '#D7DEEF'} align="center">
            {statusLabel}
          </AppText>
        </View>
      </View>

      {mediaMessage ? (
        <View style={[styles.mediaNotice, { borderColor: 'rgba(255,255,255,0.14)' }]}>
          <Ionicons name="cloud-offline-outline" size={16} color="#F2C97D" />
          <AppText variant="caption" color="#F2C97D" style={styles.flex} align="center">
            {mediaMessage}
          </AppText>
          {accessToken.isError && env.livekitUrl ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tekrar dene"
              onPress={() => void accessToken.refetch()}
            >
              <AppText variant="caption" color="#FFFFFF">
                Tekrar dene
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.controls, { paddingBottom: insets.bottom + 28 }]}>
        {incoming ? (
          <View style={styles.incomingRow}>
            <Control
              icon="close"
              label="Reddet"
              background="#E5484D"
              onPress={() => respondToCall(false)}
              busy={respond.isPending}
            />
            <Control
              icon="call"
              label="Kabul et"
              background="#2FBF71"
              onPress={() => respondToCall(true)}
              busy={respond.isPending}
            />
          </View>
        ) : finished ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kapat"
            onPress={close}
            style={({ pressed }) => [
              styles.closeButton,
              { backgroundColor: theme.colors.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <AppText variant="label" color="onPrimary">
              Kapat
            </AppText>
          </Pressable>
        ) : (
          <>
            <View style={styles.controlRow}>
              <Control
                icon={media.micEnabled ? 'mic-outline' : 'mic-off-outline'}
                label={media.micEnabled ? 'Sessize al' : 'Sesi aç'}
                onPress={toggleMic}
                disabled={!live}
              />
              <Control icon="volume-high-outline" label="Hoparlör" disabled />
              {video ? (
                <Control
                  icon={media.cameraEnabled ? 'videocam-outline' : 'videocam-off-outline'}
                  label={media.cameraEnabled ? 'Kamerayı kapat' : 'Kamerayı aç'}
                  onPress={toggleCamera}
                  disabled={!live}
                />
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Aramayı bitir"
              onPress={hangUp}
              style={({ pressed }) => [
                styles.hangup,
                { backgroundColor: '#E5484D', opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="call" size={26} color="#FFFFFF" style={styles.hangupIcon} />
            </Pressable>
            <AppText variant="caption" color="#A2AEC7" align="center">
              Aramayı bitir
            </AppText>
          </>
        )}
      </View>

      <View style={[styles.minimize, { top: insets.top + 8 }]}>
        <IconButton
          name="chevron-down"
          accessibilityLabel="Aramayı küçült"
          variant="surface"
          size={18}
          onPress={close}
        />
      </View>
    </View>
  );
}

function Control({
  icon,
  label,
  onPress,
  background = 'rgba(255,255,255,0.14)',
  busy = false,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress?: () => void;
  background?: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={styles.control}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, busy }}
        disabled={disabled || busy}
        onPress={onPress}
        style={({ pressed }) => [
          styles.controlButton,
          { backgroundColor: background, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        ]}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Ionicons name={icon} size={22} color="#FFFFFF" />
        )}
      </Pressable>
      <AppText variant="caption" color="#A2AEC7">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B1020' },
  loadingRoot: {
    flex: 1,
    backgroundColor: '#0B1020',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  top: { alignItems: 'center', gap: 6, paddingHorizontal: 30, paddingBottom: 18 },
  topScrim: { backgroundColor: 'rgba(9, 13, 26, 0.55)' },
  kindPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 12,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12 },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#7CE0AE' },
  mediaNotice: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 220,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(11,16,32,0.55)',
  },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 16 },
  incomingRow: { flexDirection: 'row', gap: 56, alignItems: 'center' },
  controlRow: { flexDirection: 'row', gap: 22 },
  control: { alignItems: 'center', gap: 6 },
  controlButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hangup: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  hangupIcon: { transform: [{ rotate: '135deg' }] },
  closeButton: { paddingHorizontal: 30, paddingVertical: 13, borderRadius: 999 },
  minimize: { position: 'absolute', right: 16 },
  flex: { flex: 1 },
});
