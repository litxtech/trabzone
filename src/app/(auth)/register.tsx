import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Pressable, StyleSheet, View, Platform } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { AuthScreen, InlineLink } from '@/features/auth/components/AuthScreen';
import { WebRegisterPage } from '@/features/web/components/WebRegisterPage';
import { SocialAuthButtons } from '@/features/auth/components/SocialAuthButtons';
import { env } from '@/config/env';
import { FormError } from '@/features/auth/components/FormError';
import {
  passwordStrength,
  registerSchema,
  type RegisterValues,
} from '@/features/auth/validators';
import { isUsernameAvailable } from '@/features/profile/services/profile-service';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { signUpWithPassword } from '@/services/supabase/auth';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

type UsernameState = 'idle' | 'checking' | 'available' | 'taken';

export default function RegisterRoute() {
  return Platform.OS === 'web' ? <WebRegisterPage /> : <RegisterScreen />;
}

function RegisterScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const [formError, setFormError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      username: '',
      email: '',
      password: '',
      passwordConfirm: '',
      acceptedTerms: false,
    },
    mode: 'onBlur',
  });

  const username = useWatch({ control, name: 'username' });
  const password = useWatch({ control, name: 'password' });
  const debouncedUsername = useDebouncedValue(username, 450);
  const strength = passwordStrength(password);

  const { data: isAvailable, isFetching } = useQuery({
    queryKey: ['username-availability', debouncedUsername],
    queryFn: () => isUsernameAvailable(debouncedUsername),
    enabled: debouncedUsername.length >= 3,
    staleTime: 60_000,
    retry: 1,
  });

  const usernameState: UsernameState =
    debouncedUsername.length < 3
      ? 'idle'
      : isFetching || isAvailable === undefined
        ? 'checking'
        : isAvailable
          ? 'available'
          : 'taken';

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    if (usernameState === 'taken') {
      haptics.error();
      setFormError('Bu kullanıcı adı alınmış. Başka bir tane dene.');
      return;
    }

    const result = await signUpWithPassword({
      email: values.email,
      password: values.password,
      firstName: values.firstName,
      lastName: values.lastName,
      username: values.username,
    });

    if (!result.ok) {
      haptics.error();
      setFormError(result.error.message);
      return;
    }

    haptics.success();
    router.push({ pathname: '/verify', params: { email: values.email } });
  });

  const usernameHint =
    usernameState === 'taken'
      ? 'Bu kullanıcı adı alınmış'
      : usernameState === 'available'
        ? 'Kullanıcı adı uygun'
        : 'En az 3 karakter; küçük harf, rakam, nokta, alt çizgi';

  return (
    <AuthScreen
      title="Hesap oluştur"
      subtitle="Trabzone'a katılmak için birkaç bilgi yeterli."
    >
      <FormError message={formError} />

      <View style={styles.form}>
        <View style={styles.row}>
          <View style={styles.half}>
            <Controller
              control={control}
              name="firstName"
              render={({ field, fieldState }) => (
                <TextField
                  label="Ad"
                  placeholder="Adın"
                  autoComplete="given-name"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
          </View>
          <View style={styles.half}>
            <Controller
              control={control}
              name="lastName"
              render={({ field, fieldState }) => (
                <TextField
                  label="Soyad"
                  placeholder="Soyadın"
                  autoComplete="family-name"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
          </View>
        </View>

        <Controller
          control={control}
          name="username"
          render={({ field, fieldState }) => (
            <TextField
              label="Kullanıcı adı"
              placeholder="kullaniciadi"
              autoCapitalize="none"
              autoComplete="username-new"
              leftIcon="at-outline"
              value={field.value}
              onChangeText={(text) => field.onChange(text.toLowerCase())}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              hint={usernameHint}
              rightSlot={
                usernameState === 'checking' ? (
                  <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.textTertiary} />
                ) : usernameState === 'available' ? (
                  <Ionicons name="checkmark-circle" size={19} color={theme.colors.success} />
                ) : usernameState === 'taken' ? (
                  <Ionicons name="close-circle" size={19} color={theme.colors.danger} />
                ) : undefined
              }
            />
          )}
        />

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
              autoComplete="password-new"
              textContentType="newPassword"
              leftIcon="lock-closed-outline"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        {password ? (
          <View style={styles.strengthRow}>
            {[0, 1, 2, 3].map((index) => (
              <View
                key={index}
                style={[
                  styles.strengthBar,
                  {
                    backgroundColor:
                      strength.score > index
                        ? strength.score >= 3
                          ? theme.colors.success
                          : theme.colors.warning
                        : theme.colors.border,
                  },
                ]}
              />
            ))}
            <AppText variant="caption" color="textTertiary">
              {strength.label}
            </AppText>
          </View>
        ) : null}

        <Controller
          control={control}
          name="passwordConfirm"
          render={({ field, fieldState }) => (
            <TextField
              label="Şifre tekrar"
              placeholder="••••••••"
              secure
              autoCapitalize="none"
              autoComplete="password-new"
              textContentType="newPassword"
              leftIcon="lock-closed-outline"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="acceptedTerms"
          render={({ field, fieldState }) => (
            <View style={{ gap: 4 }}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: field.value }}
                onPress={() => field.onChange(!field.value)}
                style={styles.termsRow}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: fieldState.error ? theme.colors.danger : theme.colors.borderStrong,
                      backgroundColor: field.value ? theme.colors.primary : 'transparent',
                      borderRadius: theme.radius.xs,
                    },
                  ]}
                >
                  {field.value ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                </View>
                <AppText variant="caption" color="textSecondary" style={styles.termsText}>
                  Kullanım koşullarını ve gizlilik politikasını okudum, kabul ediyorum.
                </AppText>
              </Pressable>
              <View style={styles.legalRow}>
                <Pressable
                  accessibilityRole="link"
                  hitSlop={6}
                  onPress={() => router.push({ pathname: '/policy/[slug]', params: { slug: 'terms' } })}
                >
                  <AppText variant="caption" color="primary">
                    Kullanım Koşulları
                  </AppText>
                </Pressable>
                <AppText variant="caption" color="textTertiary">
                  ·
                </AppText>
                <Pressable
                  accessibilityRole="link"
                  hitSlop={6}
                  onPress={() => router.push({ pathname: '/policy/[slug]', params: { slug: 'privacy' } })}
                >
                  <AppText variant="caption" color="primary">
                    Gizlilik Politikası
                  </AppText>
                </Pressable>
              </View>
              {fieldState.error ? (
                <AppText variant="caption" color="danger">
                  {fieldState.error.message}
                </AppText>
              ) : null}
            </View>
          )}
        />
      </View>

      <Button label="Devam et" loading={formState.isSubmitting} onPress={() => void onSubmit()} />

      {env.enableSocialAuth ? (
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
          Zaten hesabın var mı?
        </AppText>
        <InlineLink label="Giriş yap" onPress={() => router.replace('/login')} />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -4 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  termsText: { flex: 1 },
  legalRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 32 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: -2 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.1)' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
});
