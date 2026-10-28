import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { AuthScreen, InlineLink } from '@/features/auth/components/AuthScreen';
import { FormError } from '@/features/auth/components/FormError';
import { OtpInput } from '@/features/auth/components/OtpInput';
import { finishSignUpFromMetadata } from '@/features/auth/signup-completion';
import { applyWebRegistrationMetadata } from '@/features/auth/web-registration';
import { resendSignUpOtp, verifySignUpOtp } from '@/services/supabase/auth';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

export default function VerifyScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === 'string' ? params.email : '';

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(45);

  useEffect(() => {
    if (cooldown <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const verify = async () => {
    if (code.length !== 6) {
      setError('6 haneli kodu gir.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await verifySignUpOtp(email, code);

    if (!result.ok) {
      setSubmitting(false);
      haptics.error();
      setError(result.error.message);
      setCode('');
      return;
    }

    const applied = await applyWebRegistrationMetadata();
    if (!applied.ok) {
      setSubmitting(false);
      haptics.error();
      setError(applied.error.message);
      return;
    }

    // Kayıt sırasında ad, soyad ve kullanıcı adı zaten alındığı için profil
    // burada tekrar sorulmadan tamamlanır; ekran yalnızca eksik bilgi varsa
    // (ör. sosyal giriş) gösterilir.
    const destination = await finishSignUpFromMetadata();
    setSubmitting(false);
    haptics.success();
    await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    router.replace(destination);
  };

  const resend = async () => {
    if (cooldown > 0 || resending) {
      return;
    }
    setResending(true);
    setError(null);
    const result = await resendSignUpOtp(email);
    setResending(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCooldown(45);
    haptics.success();
  };

  return (
    <AuthScreen
      title="E-postanı doğrula"
      subtitle={`${email || 'E-posta adresine'} gönderdiğimiz 6 haneli kodu gir.`}
    >
      <FormError message={error} />

      <OtpInput value={code} onChange={setCode} error={error} />

      <View style={styles.actions}>
        <Button label="Doğrula" loading={submitting} onPress={verify} />
        <Button
          label={cooldown > 0 ? `Tekrar gönder (${cooldown}s)` : 'Kodu tekrar gönder'}
          variant="ghost"
          disabled={cooldown > 0}
          loading={resending}
          onPress={resend}
          leftIcon={<Ionicons name="refresh-outline" size={17} color={theme.colors.textSecondary} />}
        />
      </View>

      <View style={styles.hintBlock}>
        <AppText variant="caption" color="textTertiary" align="center">
          Kod 10 dakika geçerlidir. E-posta gelmediyse spam klasörünü kontrol et.
        </AppText>
        <InlineLink label="E-posta adresini değiştir" onPress={() => router.replace('/register')} />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  hintBlock: { alignItems: 'center', gap: 8 },
});
