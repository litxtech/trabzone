import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppText } from '@/components/ui';
import { env } from '@/config/env';
import { fetchPendingAcceptances } from '@/features/legal/services/legal-service';
import { fetchMyProfile } from '@/features/profile/services/profile-service';
import {
  signInWithApple,
  signInWithGoogle,
  type SocialProvider,
} from '@/services/supabase/auth';
import { haptics } from '@/utils/haptics';

type Props = {
  /** Auth formlarinda satir ici hata gostermek icin. */
  onError?: (message: string) => void;
  /** Lobi gibi yerlerde alert yerine satir ici mesaj gostermek icin false. */
  showInlineError?: boolean;
};

function GoogleMark({ size = 19 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

export function SocialAuthButtons({ onError, showInlineError = true }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (provider: SocialProvider) => {
      if (pending) {
        return;
      }
      haptics.tap();
      setError(null);
      setPending(provider);

      const result =
        provider === 'apple' ? await signInWithApple() : await signInWithGoogle();

      setPending(null);

      if (!result.ok) {
        if (result.error.code === 'oauth_cancelled') {
          return;
        }
        haptics.error();
        setError(result.error.message);
        if (!showInlineError) {
          Alert.alert('Giriş yapılamadı', result.error.message);
        }
        onError?.(result.error.message);
        return;
      }

      const [profile, pendingResult] = await Promise.all([
        fetchMyProfile(),
        fetchPendingAcceptances(),
      ]);
      const completed = profile.ok && profile.data?.onboarding_completed;
      haptics.success();
      if (!completed) {
        router.replace('/complete-profile');
        return;
      }
      if (pendingResult.ok && pendingResult.data.length > 0) {
        router.replace('/legal/consent');
        return;
      }
      router.replace('/feed');
    },
    [onError, pending, router, showInlineError],
  );

  const disabled = pending !== null;

  // OAuth sağlayıcıları yapılandırılmadan çalışmayan bir buton gösterme.
  if (!env.enableSocialAuth) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Apple ile devam et"
        accessibilityState={{ disabled, busy: pending === 'apple' }}
        disabled={disabled}
        onPress={() => void run('apple')}
        style={({ pressed }) => [
          styles.button,
          styles.apple,
          {
            opacity: disabled && pending !== 'apple' ? 0.55 : pressed ? 0.82 : 1,
            transform: [{ scale: pressed ? 0.99 : 1 }],
          },
        ]}
      >
        {pending === 'apple' ? (
          <ActivityIndicator size="small" color="#05070D" />
        ) : (
          <Ionicons name="logo-apple" size={20} color="#05070D" />
        )}
        <AppText variant="bodyStrong" color="#05070D" style={styles.label}>
          Apple ile Devam Et
        </AppText>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Google ile devam et"
        accessibilityState={{ disabled, busy: pending === 'google' }}
        disabled={disabled}
        onPress={() => void run('google')}
        style={({ pressed }) => [
          styles.button,
          styles.google,
          {
            opacity: disabled && pending !== 'google' ? 0.55 : pressed ? 0.82 : 1,
            transform: [{ scale: pressed ? 0.99 : 1 }],
          },
        ]}
      >
        {pending === 'google' ? (
          <ActivityIndicator size="small" color="#1A1D24" />
        ) : (
          <GoogleMark />
        )}
        <AppText variant="bodyStrong" color="#1A1D24" style={styles.label}>
          Google ile Devam Et
        </AppText>
      </Pressable>

      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="information-circle-outline" size={14} color="#FF8A8E" />
          <AppText variant="caption" color="#FFB4B7" style={styles.errorText}>
            {error}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 9 },
  button: {
    height: 52,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 16,
  },
  apple: {
    backgroundColor: '#FFFFFF',
  },
  google: {
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D9DEE9',
  },
  label: { fontSize: 15 },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  errorText: { flex: 1, lineHeight: 17 },
});
