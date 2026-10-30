import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Link, type Href } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { AppText, Button, TextField } from '@/components/ui';
import { socialAvailability } from '@/features/auth/social-availability';
import { SocialAuthButtons } from '@/features/auth/components/SocialAuthButtons';
import { UsernameStatusIcon } from '@/features/auth/components/UsernameStatusIcon';
import {
  USERNAME_HINT,
  USERNAME_HINT_TONE,
  ensureUsernameAvailable,
  useUsernameAvailability,
} from '@/features/auth/hooks/use-username-availability';
import {
  emailSchema,
  nameSchema,
  passwordSchema,
  passwordStrength,
  usernameSchema,
} from '@/features/auth/validators';
import { finishSignUpFromMetadata } from '@/features/auth/signup-completion';
import { applyWebRegistrationMetadata } from '@/features/auth/web-registration';
import { RegistrationConsentBox } from '@/features/legal/components/RegistrationPolicies';
import { signUpWithPassword } from '@/services/supabase/auth';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import { useWebMeta } from '../use-web-meta';
import { WebAuthLayout } from './WebAuthLayout';

function ageFromIsoDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  if (date > now) return null;
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - date.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < date.getUTCDate())) {
    age -= 1;
  }
  return age;
}

const webRegisterSchema = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    username: usernameSchema,
    email: emailSchema,
    birthDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Doğum tarihini YYYY-AA-GG biçiminde gir')
      .refine((value) => {
        const age = ageFromIsoDate(value);
        return age !== null && age >= 13 && age <= 120;
      }, 'Trabzone için en az 13 yaşında olmalısın'),
    password: passwordSchema,
    passwordConfirm: z.string().min(1, 'Şifreyi tekrar gir'),
    acceptedTerms: z
      .boolean()
      .refine(
        (value) => value,
        'Devam etmek için kullanım koşullarını ve tüm politikaları kabul etmelisin',
      ),
    marketingOptIn: z.boolean(),
    analyticsOptIn: z.boolean(),
  })
  .refine((values) => values.password === values.passwordConfirm, {
    message: 'Şifreler eşleşmiyor',
    path: ['passwordConfirm'],
  });

type WebRegisterValues = z.infer<typeof webRegisterSchema>;

export function WebRegisterPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const [formError, setFormError] = useState<string | null>(null);

  useWebMeta({
    title: 'Trabzone Hesap Oluştur',
    description:
      'Trabzone hesabı oluştur; sosyal akış, Reels, Marketplace ve Trabzon keşif dünyasına katıl.',
    path: '/register',
    noIndex: true,
  });

  const { control, handleSubmit, formState } = useForm<WebRegisterValues>({
    resolver: zodResolver(webRegisterSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      username: '',
      email: '',
      birthDate: '',
      password: '',
      passwordConfirm: '',
      acceptedTerms: false,
      marketingOptIn: false,
      analyticsOptIn: false,
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
      setFormError(USERNAME_HINT[usernameState]);
      return;
    }
    // Gösterge eskiyse gönderimi beklemeden taze sorgu; ağ hatasında kararı
    // `complete_registration` verir.
    if (usernameState !== 'available') {
      const check = await ensureUsernameAvailable(values.username);
      if (check === 'taken') {
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
      birthDate: values.birthDate,
      acceptedTerms: values.acceptedTerms,
      marketingOptIn: values.marketingOptIn,
      analyticsOptIn: values.analyticsOptIn,
    });

    if (!result.ok) {
      setFormError(result.error.message);
      return;
    }

    if (result.data.needsVerification) {
      router.push({ pathname: '/verify', params: { email: values.email } });
      return;
    }

    const applied = await applyWebRegistrationMetadata();
    if (!applied.ok) {
      setFormError(
        `Hesabın oluşturuldu ancak sözleşme kaydı tamamlanamadı: ${applied.error.message} Destek ekibimize ulaşabilirsin.`,
      );
      return;
    }

    const destination = await finishSignUpFromMetadata();
    await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    router.replace(destination);
  });

  return (
    <WebAuthLayout
      eyebrow="TRABZONE'A KATIL"
      title="Hesap oluştur"
      subtitle="Birkaç bilgiyle Trabzon'un dijital dünyasına katıl. Aynı hesap tüm cihazlarda geçerlidir."
      footer={
        <View style={styles.footer}>
          <AppText variant="caption" color="textSecondary">
            Zaten hesabın var mı?
          </AppText>
          <Link href={'/login' as Href} asChild>
            <Pressable>
              <AppText variant="caption" color="primary" style={styles.linkStrong}>
                Giriş yap
              </AppText>
            </Pressable>
          </Link>
        </View>
      }
    >
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
              hint={USERNAME_HINT[usernameState]}
              hintTone={USERNAME_HINT_TONE[usernameState]}
              rightSlot={<UsernameStatusIcon state={usernameState} />}
            />
          )}
        />

        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <TextField
              label="E-posta"
              placeholder="ornek@eposta.com"
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
          name="birthDate"
          render={({ field, fieldState }) => (
            <TextField
              label="Doğum tarihi"
              placeholder="YYYY-AA-GG"
              autoCapitalize="none"
              leftIcon="calendar-outline"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              hint="Trabzone için en az 13 yaşında olmalısın. 18 yaş altı hesaplarda koruyucu gizlilik ayarları uygulanır."
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

        <View style={[styles.legalBox, { borderColor: theme.colors.border }]}>
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

          <View style={[styles.optionalDivider, { backgroundColor: theme.colors.border }]} />
          <AppText variant="caption" color="textTertiary">
            İsteğe bağlı — işaretlemezsen hesap oluşturman engellenmez.
          </AppText>
          <Controller
            control={control}
            name="marketingOptIn"
            render={({ field }) => (
              <CheckRow checked={field.value} onToggle={() => field.onChange(!field.value)}>
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  Kampanya ve yenilikler hakkında pazarlama e-postası almak istiyorum.
                </AppText>
              </CheckRow>
            )}
          />
          <Controller
            control={control}
            name="analyticsOptIn"
            render={({ field }) => (
              <CheckRow checked={field.value} onToggle={() => field.onChange(!field.value)}>
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  Deneyimi iyileştirmek için isteğe bağlı ürün analitiği verilerinin işlenmesine izin
                  veriyorum.
                </AppText>
              </CheckRow>
            )}
          />
          <AppText variant="caption" color="textTertiary">
            Verdiğin isteğe bağlı rızaları daha sonra ayarlardan geri alabilirsin.
          </AppText>
        </View>

        {socialAvailability().any ? (
          <>
            <View style={styles.divider}>
              <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
              <AppText variant="caption" color="textTertiary">
                veya
              </AppText>
              <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
            </View>
            <SocialAuthButtons />
          </>
        ) : null}

        {formError ? (
          <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={17} color={theme.colors.danger} />
            <AppText variant="caption" color="danger" style={styles.flex}>
              {formError}
            </AppText>
          </View>
        ) : null}

        <Button
          label={formState.isSubmitting ? 'Hesap oluşturuluyor…' : 'Hesabımı oluştur'}
          size="lg"
          loading={formState.isSubmitting}
          onPress={() => void onSubmit()}
        />
        <AppText variant="caption" color="textTertiary" align="center">
          Kayıt olarak yukarıdaki sözleşme, politika ve kuralların tamamını kabul etmiş olursun. Onay
          kaydın hesabına işlenir; girişte tekrar sorulmaz. İsteğe bağlı rızalar hesap oluşturma
          şartı değildir.
        </AppText>
      </View>
    </WebAuthLayout>
  );
}

function CheckRow({
  checked,
  onToggle,
  error,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  error?: string;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.checkWrap}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={onToggle}
        style={styles.checkRow}
      >
        <View
          style={[
            styles.checkbox,
            {
              borderColor: error ? theme.colors.danger : theme.colors.borderStrong,
              backgroundColor: checked ? theme.colors.primary : 'transparent',
            },
          ]}
        >
          {checked ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}
        </View>
        {children}
      </Pressable>
      {error ? (
        <AppText variant="caption" color="danger" style={styles.checkError}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: 14 },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -4 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  legalBox: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  optionalDivider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  checkWrap: { gap: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkError: { marginLeft: 30 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 10 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 },
  linkStrong: { fontWeight: '600' },
});
