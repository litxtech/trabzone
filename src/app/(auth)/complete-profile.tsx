import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/utils/router';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Skeleton, TextField } from '@/components/ui';
import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { FormError } from '@/features/auth/components/FormError';
import { UsernameStatusIcon } from '@/features/auth/components/UsernameStatusIcon';
import {
  USERNAME_HINT,
  USERNAME_HINT_TONE,
  ensureUsernameAvailable,
  useUsernameAvailability,
} from '@/features/auth/hooks/use-username-availability';
import {
  completeProfileSchema,
  type CompleteProfileValues,
} from '@/features/auth/validators';
import { completeRegistration, fetchMyProfile } from '@/features/profile/services/profile-service';
import { fetchPendingAcceptances } from '@/features/legal/services/legal-service';
import { getSignUpMetadata } from '@/services/supabase/auth';
import { haptics } from '@/utils/haptics';

export default function CompleteProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Profilde kayıtlı ad: kendi kullanıcı adı "alınmış" görünmemeli.
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  // Hesabın e-postası: Apple/Google girişinde otomatik doldurulur, düzenlenemez.
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [emailIsAppleRelay, setEmailIsAppleRelay] = useState(false);

  const { control, handleSubmit, reset, formState } = useForm<CompleteProfileValues>({
    resolver: zodResolver(completeProfileSchema),
    defaultValues: { username: '', firstName: '', lastName: '' },
    mode: 'onBlur',
  });

  useEffect(() => {
    let cancelled = false;

    Promise.all([fetchMyProfile(), getSignUpMetadata()]).then(([result, metadata]) => {
      if (cancelled) {
        return;
      }

      if (result.ok && result.data?.onboarding_completed) {
        router.replace('/feed');
        return;
      }

      const profile = result.ok ? result.data : null;
      const savedUsername = profile?.username ?? '';
      const username = savedUsername.startsWith('u_')
        ? (metadata.suggestedUsername ?? '')
        : savedUsername;
      const firstName =
        metadata.firstName ??
        (profile?.first_name && profile.first_name !== 'Trabzone' ? profile.first_name : '');
      const lastName =
        metadata.lastName ??
        (profile?.last_name && profile.last_name !== 'Üyesi' ? profile.last_name : '');

      reset({ username, firstName, lastName });
      setSavedUsername(profile?.username ?? null);
      setAccountEmail(metadata.email);
      setEmailIsAppleRelay(metadata.emailIsAppleRelay);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [reset, router]);

  const usernameValue = useWatch({ control, name: 'username' });
  const usernameCheck = useUsernameAvailability(usernameValue, { ownUsername: savedUsername });
  const usernameState = usernameCheck.state;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    if (usernameState === 'taken' || usernameState === 'reserved') {
      haptics.error();
      setFormError(USERNAME_HINT[usernameState]);
      return;
    }

    if (usernameState !== 'available') {
      const normalized = values.username.trim().toLowerCase();
      const isOwnUsername =
        Boolean(savedUsername) && normalized === (savedUsername ?? '').trim().toLowerCase();
      // Profilde zaten kayıtlı olan ad "alınmış" sayılmaz; aksi halde kullanıcı
      // kendi adıyla formu hiç gönderemiyordu.
      if (!isOwnUsername) {
        const check = await ensureUsernameAvailable(values.username);
        if (check === 'taken') {
          haptics.error();
          setFormError(USERNAME_HINT.taken);
          return;
        }
      }
    }

    const result = await completeRegistration(values);
    if (!result.ok) {
      haptics.error();
      setFormError(result.error.message);
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    haptics.success();

    const pending = await fetchPendingAcceptances();
    if (pending.ok && pending.data.length > 0) {
      router.replace('/legal/consent');
      return;
    }
    router.replace('/feed');
  });

  if (loading) {
    return (
      <AuthScreen title="Profilini tamamla" subtitle="Seni tanıyalım." showBack={false}>
        <View style={{ gap: 16 }}>
          <Skeleton height={54} radius={16} />
          <Skeleton height={54} radius={16} />
          <Skeleton height={54} radius={16} />
        </View>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Profilini tamamla"
      subtitle="Kullanıcı adın profil bağlantında görünecek ve sonradan zor değişir."
      showBack={false}
    >
      <FormError message={formError} />

      <View style={styles.form}>
        <TextField
          label="E-posta"
          value={accountEmail ?? ''}
          placeholder="E-posta bağlı değil"
          editable={false}
          leftIcon="mail-outline"
          autoCapitalize="none"
          hint={
            emailIsAppleRelay
              ? 'Apple gizli e-posta kullandı. Gerçek adresini sonra Ayarlar → Hesap bölümünden ekleyebilirsin.'
              : undefined
          }
        />

        <View style={styles.row}>
          <View style={styles.half}>
            <Controller
              control={control}
              name="firstName"
              render={({ field, fieldState }) => (
                <TextField
                  label="Ad"
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
      </View>

      <AppText variant="caption" color="textTertiary">
        Devam ettiğinde güncel kullanım koşulları ve topluluk kuralları onayı istenecek.
      </AppText>

      <Button label="Trabzone'a gir" loading={formState.isSubmitting} onPress={() => void onSubmit()} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
});
