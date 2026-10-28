import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, type Href } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { AppText, Button, TextField } from '@/components/ui';
import {
  emailSchema,
  nameSchema,
  passwordSchema,
  passwordStrength,
  usernameSchema,
} from '@/features/auth/validators';
import { applyWebRegistrationMetadata } from '@/features/auth/web-registration';
import { isUsernameAvailable } from '@/features/profile/services/profile-service';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
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
    acceptedTerms: z.boolean().refine((value) => value, 'Kullanım Koşullarını kabul etmelisin'),
    acceptedGuidelines: z
      .boolean()
      .refine((value) => value, 'Topluluk Kurallarını kabul etmelisin'),
    acknowledgedPrivacy: z
      .boolean()
      .refine((value) => value, 'Gizlilik ve KVKK aydınlatmasını okuduğunu onaylamalısın'),
    marketingOptIn: z.boolean(),
    analyticsOptIn: z.boolean(),
  })
  .refine((values) => values.password === values.passwordConfirm, {
    message: 'Şifreler eşleşmiyor',
    path: ['passwordConfirm'],
  });

type WebRegisterValues = z.infer<typeof webRegisterSchema>;

function openPolicy(path: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(path, '_blank', 'noopener,noreferrer');
    return;
  }
}

export function WebRegisterPage() {
  const router = useRouter();
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
      acceptedGuidelines: false,
      acknowledgedPrivacy: false,
      marketingOptIn: false,
      analyticsOptIn: false,
    },
    mode: 'onBlur',
  });

  const username = useWatch({ control, name: 'username' });
  const password = useWatch({ control, name: 'password' });
  const debouncedUsername = useDebouncedValue(username, 450);
  const strength = passwordStrength(password);

  const { data: available, isFetching } = useQuery({
    queryKey: ['username-availability', debouncedUsername],
    queryFn: () => isUsernameAvailable(debouncedUsername),
    enabled: debouncedUsername.length >= 3,
    staleTime: 60_000,
    retry: 1,
  });

  const usernameState =
    debouncedUsername.length < 3
      ? 'idle'
      : isFetching || available === undefined
        ? 'checking'
        : available
          ? 'available'
          : 'taken';

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (usernameState === 'taken') {
      setFormError('Bu kullanıcı adı alınmış. Başka bir tane dene.');
      return;
    }

    const result = await signUpWithPassword({
      email: values.email,
      password: values.password,
      firstName: values.firstName,
      lastName: values.lastName,
      username: values.username,
      birthDate: values.birthDate,
      acceptedTerms: values.acceptedTerms,
      acceptedGuidelines: values.acceptedGuidelines,
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
    router.replace('/complete-profile');
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
              hint={
                usernameState === 'taken'
                  ? 'Bu kullanıcı adı alınmış'
                  : usernameState === 'available'
                    ? 'Kullanıcı adı uygun'
                    : '3-24 karakter; küçük harf, rakam, nokta ve alt çizgi'
              }
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
              <CheckRow
                checked={field.value}
                onToggle={() => field.onChange(!field.value)}
                error={fieldState.error?.message}
              >
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  <AppText
                    variant="caption"
                    color="primary"
                    onPress={() => openPolicy('/terms')}
                  >
                    Trabzone Kullanım Koşullarını
                  </AppText>{' '}
                  okudum ve kabul ediyorum.
                </AppText>
              </CheckRow>
            )}
          />
          <Controller
            control={control}
            name="acceptedGuidelines"
            render={({ field, fieldState }) => (
              <CheckRow
                checked={field.value}
                onToggle={() => field.onChange(!field.value)}
                error={fieldState.error?.message}
              >
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  <AppText
                    variant="caption"
                    color="primary"
                    onPress={() => openPolicy('/community-guidelines')}
                  >
                    Trabzone Topluluk Kurallarını
                  </AppText>{' '}
                  okudum ve kabul ediyorum.
                </AppText>
              </CheckRow>
            )}
          />
          <Controller
            control={control}
            name="acknowledgedPrivacy"
            render={({ field, fieldState }) => (
              <CheckRow
                checked={field.value}
                onToggle={() => field.onChange(!field.value)}
                error={fieldState.error?.message}
              >
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  <AppText variant="caption" color="primary" onPress={() => openPolicy('/privacy')}>
                    Gizlilik Politikası
                  </AppText>
                  ,{' '}
                  <AppText variant="caption" color="primary" onPress={() => openPolicy('/kvkk')}>
                    KVKK Aydınlatma Metni
                  </AppText>{' '}
                  ve{' '}
                  <AppText
                    variant="caption"
                    color="primary"
                    onPress={() => openPolicy('/child-safety')}
                  >
                    Çocuk Koruma Politikası
                  </AppText>{' '}
                  hakkında bilgilendirildim.
                </AppText>
              </CheckRow>
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

        <View style={[styles.socialNote, { borderColor: theme.colors.border }]}>
          <Ionicons name="phone-portrait-outline" size={18} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Apple ve Google ile kayıt şu anda mobil uygulamada kullanılabilir. Web üzerinde e-posta
            ile hesap oluşturabilirsin.
          </AppText>
        </View>

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
          Kayıt olarak Trabzone&apos;un sözleşme ve topluluk kurallarını kabul etmiş olursun. Zorunlu
          olmayan rızalar hesap oluşturma şartı değildir.
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
  socialNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 10 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 },
  linkStrong: { fontWeight: '600' },
});
