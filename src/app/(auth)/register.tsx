import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, View, Platform } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { AuthScreen, InlineLink } from '@/features/auth/components/AuthScreen';
import { RegistrationConsentBox } from '@/features/legal/components/RegistrationPolicies';
import { WebRegisterPage } from '@/features/web/components/WebRegisterPage';
import { SocialAuthButtons } from '@/features/auth/components/SocialAuthButtons';
import { socialAvailability } from '@/features/auth/social-availability';
import { FormError } from '@/features/auth/components/FormError';
import {
  USERNAME_HINT,
  USERNAME_HINT_TONE,
  ensureUsernameAvailable,
  useUsernameAvailability,
} from '@/features/auth/hooks/use-username-availability';
import {
  passwordStrength,
  registerSchema,
  type RegisterValues,
} from '@/features/auth/validators';
import { finishSignUpFromMetadata } from '@/features/auth/signup-completion';
import { applyWebRegistrationMetadata } from '@/features/auth/web-registration';
import { UsernameStatusIcon } from '@/features/auth/components/UsernameStatusIcon';
import { signUpWithPassword } from '@/services/supabase/auth';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { inputToBirthDate } from '@/utils/date';

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
      birthDate: '',
      email: '',
      password: '',
      passwordConfirm: '',
      acceptedTerms: false,
    },
    mode: 'onBlur',
  });

  const username = useWatch({ control, name: 'username' });
  const password = useWatch({ control, name: 'password' });
  const strength = passwordStrength(password);
  const usernameCheck = useUsernameAvailability(username);
  const usernameState = usernameCheck.state;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    if (usernameState === 'taken' || usernameState === 'reserved') {
      haptics.error();
      setFormError(USERNAME_HINT[usernameState]);
      return;
    }

    // Gösterge eskiyse (yazmayı yeni bıraktı) gönderimi beklemeden taze
    // sorgu yapılır; ağ hatasında kararı sunucu verir.
    if (usernameState !== 'available') {
      const check = await ensureUsernameAvailable(values.username);
      if (check === 'taken') {
        haptics.error();
        setFormError(USERNAME_HINT.taken);
        return;
      }
    }

    const result = await signUpWithPassword({
      email: values.email,
      password: values.password,
      firstName: values.firstName,
      lastName: values.lastName,
      username: values.username,
      birthDate: inputToBirthDate(values.birthDate) ?? undefined,
      acceptedTerms: values.acceptedTerms,
    });

    if (!result.ok) {
      haptics.error();
      setFormError(result.error.message);
      return;
    }

    haptics.success();

    if (result.data.needsVerification) {
      router.push({ pathname: '/verify', params: { email: values.email } });
      return;
    }

    await applyWebRegistrationMetadata();
    const destination = await finishSignUpFromMetadata();
    router.replace(destination);
  });

  const usernameHint = USERNAME_HINT[usernameState];

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
              hintTone={USERNAME_HINT_TONE[usernameState]}
              rightSlot={<UsernameStatusIcon state={usernameState} />}
            />
          )}
        />

        <Controller
          control={control}
          name="birthDate"
          render={({ field, fieldState }) => (
            <TextField
              label="Doğum tarihi"
              placeholder="GG.AA.YYYY"
              leftIcon="calendar-outline"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              hint="13 yaşından küçük hesaplar oluşturulamaz."
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              textContentType="birthdate"
              returnKeyType="next"
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
            <RegistrationConsentBox
              checked={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
      </View>

      <Button label="Devam et" loading={formState.isSubmitting} onPress={() => void onSubmit()} />

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
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: -2 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.1)' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
});
