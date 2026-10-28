import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { AppText, Button, TextField } from '@/components/ui';
import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { FormError } from '@/features/auth/components/FormError';
import { OtpInput } from '@/features/auth/components/OtpInput';
import { emailSchema, passwordSchema } from '@/features/auth/validators';
import {
  requestPasswordReset,
  updatePassword,
  verifyRecoveryOtp,
} from '@/services/supabase/auth';
import { haptics } from '@/utils/haptics';

const requestSchema = z.object({ email: emailSchema });
type RequestValues = z.infer<typeof requestSchema>;

const resetSchema = z
  .object({
    password: passwordSchema,
    passwordConfirm: z.string().min(1, 'Şifreyi tekrar gir'),
  })
  .refine((values) => values.password === values.passwordConfirm, {
    message: 'Şifreler eşleşmiyor',
    path: ['passwordConfirm'],
  });
type ResetValues = z.infer<typeof resetSchema>;

type Step = 'request' | 'verify' | 'done';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const requestForm = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { email: '' },
  });

  const resetForm = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', passwordConfirm: '' },
  });

  const sendCode = requestForm.handleSubmit(async (values) => {
    setFormError(null);
    setWorking(true);
    const result = await requestPasswordReset(values.email);
    setWorking(false);

    if (!result.ok) {
      setFormError(result.error.message);
      return;
    }
    haptics.success();
    setEmail(values.email);
    setStep('verify');
  });

  const submitReset = resetForm.handleSubmit(async (values) => {
    if (code.length !== 6) {
      setFormError('6 haneli kodu gir.');
      return;
    }
    setFormError(null);
    setWorking(true);

    const verified = await verifyRecoveryOtp(email, code);
    if (!verified.ok) {
      setWorking(false);
      setFormError(verified.error.message);
      return;
    }

    const updated = await updatePassword(values.password);
    setWorking(false);

    if (!updated.ok) {
      setFormError(updated.error.message);
      return;
    }

    haptics.success();
    setStep('done');
  });

  if (step === 'done') {
    return (
      <AuthScreen title="Şifren güncellendi" subtitle="Yeni şifrenle güvenle giriş yapabilirsin.">
        <View style={styles.doneIcon}>
          <Ionicons name="shield-checkmark" size={56} color="#FFFFFF" />
        </View>
        <Button label="Giriş yap" onPress={() => router.replace('/login')} />
      </AuthScreen>
    );
  }

  if (step === 'verify') {
    return (
      <AuthScreen
        title="Kodu doğrula"
        subtitle={`${email} adresine gönderdiğimiz 6 haneli kodu ve yeni şifreni gir.`}
      >
        <FormError message={formError} />

        <OtpInput value={code} onChange={setCode} error={formError} />

        <View style={styles.form}>
          <Controller
            control={resetForm.control}
            name="password"
            render={({ field, fieldState }) => (
              <TextField
                label="Yeni şifre"
                placeholder="••••••••"
                secure
                autoCapitalize="none"
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
            control={resetForm.control}
            name="passwordConfirm"
            render={({ field, fieldState }) => (
              <TextField
                label="Yeni şifre tekrar"
                placeholder="••••••••"
                secure
                autoCapitalize="none"
                textContentType="newPassword"
                leftIcon="lock-closed-outline"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
              />
            )}
          />
        </View>

        <Button label="Şifreyi güncelle" loading={working} onPress={() => void submitReset()} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Şifremi unuttum"
      subtitle="E-posta adresini gir; doğrulama kodu gönderelim."
    >
      <FormError message={formError} />

      <View style={styles.form}>
        <Controller
          control={requestForm.control}
          name="email"
          render={({ field, fieldState }) => (
            <TextField
              label="E-posta"
              placeholder="ornek@trabzone.app"
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
      </View>

      <Button label="Kod gönder" loading={working} onPress={() => void sendCode()} />

      <AppText variant="caption" color="textTertiary" align="center">
        Güvenlik için hesabın olup olmadığını bu ekranda paylaşmayız.
      </AppText>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  doneIcon: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: '#1459E8',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginVertical: 24,
  },
});
