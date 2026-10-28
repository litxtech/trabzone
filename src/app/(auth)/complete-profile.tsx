import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/utils/router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Skeleton, TextField } from '@/components/ui';
import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { FormError } from '@/features/auth/components/FormError';
import {
  completeProfileSchema,
  type CompleteProfileValues,
} from '@/features/auth/validators';
import { completeRegistration, fetchMyProfile, isUsernameAvailable } from '@/features/profile/services/profile-service';
import { getSignUpMetadata } from '@/services/supabase/auth';
import { haptics } from '@/utils/haptics';

export default function CompleteProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      const username = savedUsername.startsWith('u_') ? (metadata.username ?? '') : savedUsername;
      const firstName =
        metadata.firstName ??
        (profile?.first_name && profile.first_name !== 'Trabzone' ? profile.first_name : '');
      const lastName =
        metadata.lastName ??
        (profile?.last_name && profile.last_name !== 'Üyesi' ? profile.last_name : '');

      reset({ username, firstName, lastName });
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [reset, router]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const available = await isUsernameAvailable(values.username);
    if (!available) {
      haptics.error();
      setFormError('Bu kullanıcı adı alınmış. Başka bir tane dene.');
      return;
    }

    const result = await completeRegistration(values);
    if (!result.ok) {
      haptics.error();
      setFormError(result.error.message);
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    haptics.success();
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
              hint="3-24 karakter; küçük harf, rakam, nokta ve alt çizgi"
            />
          )}
        />
      </View>

      <AppText variant="caption" color="textTertiary">
        Devam ederek topluluk kurallarını kabul etmiş olursun.
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
