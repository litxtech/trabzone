import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useRef, useState, type ComponentRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, TextInput, View, Platform } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { AuthScreen, InlineLink } from '@/features/auth/components/AuthScreen';
import { SavedAccountsPicker } from '@/features/auth/components/SavedAccountsPicker';
import { safeNextPath } from '@/features/auth/next-path';
import { finishSignUpFromMetadata } from '@/features/auth/signup-completion';
import { rememberAccount, useSavedAccountsStore, useSavedAccounts, type SavedAccount } from '@/features/auth/saved-accounts';
import { WebLoginPage } from '@/features/web/components/WebLoginPage';
import { SocialAuthButtons } from '@/features/auth/components/SocialAuthButtons';
import { socialAvailability } from '@/features/auth/social-availability';
import { FormError } from '@/features/auth/components/FormError';
import { loginSchema, type LoginValues } from '@/features/auth/validators';
import { PolicyLinks } from '@/features/legal/components/RegistrationPolicies';
import { fetchPendingAcceptances } from '@/features/legal/services/legal-service';
import { fetchMyProfile } from '@/features/profile/services/profile-service';
import { signInWithPassword } from '@/services/supabase/auth';
import { useAuthStatus, useSession } from '@/stores/auth-store';
import { haptics } from '@/utils/haptics';

export default function LoginRoute() {
  return Platform.OS === 'web' ? <WebLoginPage /> : <LoginScreen />;
}

function LoginScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Derin baglanti / korumali sayfa yonlendirmesinden gelen hedef. Giris
  // tamamlaninca kullanici tikladigi ilana geri doner.
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeNextPath(params.next);
  const [formError, setFormError] = useState<string | null>(null);
  const savedAccounts = useSavedAccounts();
  const forgetAccount = useSavedAccountsStore((state) => state.forget);
  const authStatus = useAuthStatus();
  const session = useSession();
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  const { control, handleSubmit, formState, setValue } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onBlur',
  });

  const pickAccount = (account: SavedAccount) => {
    setFormError(null);
    setValue('email', account.email, { shouldValidate: true });
    setValue('password', '');
    if (authStatus === 'authenticated' && session?.user?.id === account.id) {
      router.replace((next ?? '/feed') as Href);
      return;
    }
    passwordRef.current?.focus();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await signInWithPassword(values.email, values.password);

    if (!result.ok) {
      haptics.error();
      setFormError(result.error.message);
      return;
    }

    const [profile, pending] = await Promise.all([fetchMyProfile(), fetchPendingAcceptances()]);
    rememberAccount({
      id: result.data.user.id,
      email: result.data.user.email ?? values.email,
      name: profile.ok
        ? `${profile.data?.first_name ?? ''} ${profile.data?.last_name ?? ''}`.trim() || undefined
        : undefined,
      username: profile.ok ? profile.data?.username : undefined,
      avatarPath: profile.ok ? profile.data?.avatar_path : undefined,
    });
    const completed = profile.ok && profile.data?.onboarding_completed;
    if (!completed) {
      // Kayıt sırasında verilen bilgiler duruyorsa profil tamamlama ekranı
      // yeniden gösterilmez; profil doğrudan tamamlanır.
      const destination = await finishSignUpFromMetadata();
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      router.replace(destination);
      return;
    }
    if (pending.ok && pending.data.length > 0) {
      router.replace('/legal/consent');
      return;
    }
    router.replace((next ?? '/feed') as Href);
  });

  return (
    <AuthScreen title="Tekrar hoş geldin" subtitle="Hesabına giriş yaparak kaldığın yerden devam et.">
      <FormError message={formError} />

      <SavedAccountsPicker
        accounts={savedAccounts}
        activeId={authStatus === 'authenticated' ? (session?.user?.id ?? null) : null}
        onPick={pickAccount}
        onForget={(account) => forgetAccount(account.id)}
      />

      <View style={styles.form}>
        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <TextField
              label="E-posta"
              placeholder="ornek@trabzoneapp.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              leftIcon="mail-outline"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="password"
          render={({ field, fieldState }) => (
            <TextField
              label="Şifre"
              placeholder="••••••••"
              secure
              autoCapitalize="none"
              autoComplete="password"
              textContentType="password"
              leftIcon="lock-closed-outline"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              ref={passwordRef}
            />
          )}
        />

        <InlineLink
          label="Şifremi unuttum"
          align="flex-start"
          onPress={() => router.push('/forgot-password')}
        />
      </View>

      <Button label="Giriş Yap" loading={formState.isSubmitting} onPress={() => void onSubmit()} />

      {socialAvailability().any ? (
        <>
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <AppText variant="caption" color="#6F7C96">
              veya
            </AppText>
            <View style={styles.dividerLine} />
          </View>

          <SocialAuthButtons />
        </>
      ) : null}

      <View style={styles.footer}>
        <AppText variant="caption" color="textSecondary">
          Henüz hesabın yok mu?
        </AppText>
        <InlineLink label="Hesap oluştur" onPress={() => router.replace('/register')} />
      </View>

      <View style={styles.legal}>
        <AppText variant="caption" color="textTertiary" align="center">
          Giriş yaparak mevcut kabul kayıtların korunur. Sözleşme, politika ve kurallar:
        </AppText>
        <PolicyLinks align="center" />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: -2 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.1)' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  legal: { gap: 8 },
});
