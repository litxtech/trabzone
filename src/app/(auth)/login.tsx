import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { AuthScreen, InlineLink } from '@/features/auth/components/AuthScreen';
import { SocialAuthButtons } from '@/features/auth/components/SocialAuthButtons';
import { FormError } from '@/features/auth/components/FormError';
import { loginSchema, type LoginValues } from '@/features/auth/validators';
import { fetchMyProfile } from '@/features/profile/services/profile-service';
import { signInWithPassword } from '@/services/supabase/auth';
import { haptics } from '@/utils/haptics';

export default function LoginScreen() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onBlur',
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await signInWithPassword(values.email, values.password);

    if (!result.ok) {
      haptics.error();
      setFormError(result.error.message);
      return;
    }

    const profile = await fetchMyProfile();
    const completed = profile.ok && profile.data?.onboarding_completed;
    router.replace(completed ? '/feed' : '/complete-profile');
  });

  return (
    <AuthScreen title="Tekrar hoş geldin" subtitle="Hesabına giriş yaparak kaldığın yerden devam et.">
      <FormError message={formError} />

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

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <AppText variant="caption" color="#6F7C96">
          veya
        </AppText>
        <View style={styles.dividerLine} />
      </View>

      <SocialAuthButtons />

      <View style={styles.footer}>
        <AppText variant="caption" color="textSecondary">
          Henüz hesabın yok mu?
        </AppText>
        <InlineLink label="Hesap oluştur" onPress={() => router.replace('/register')} />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: -2 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.1)' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
});
