import { Ionicons } from '@expo/vector-icons';
import { Link, type Href, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, TextField } from '@/components/ui';
import { signInWithPassword } from '@/services/supabase/auth';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import { useWebMeta } from '../use-web-meta';
import { WebAuthLayout } from './WebAuthLayout';

function safeNext(value: string | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
  return value;
}

export function WebLoginPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const authStatus = useAuthStatus();
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(typeof params.next === 'string' ? params.next : undefined);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useWebMeta({
    title: 'Trabzone Giriş',
    description:
      'Trabzone hesabına web üzerinden giriş yap. Aynı hesap iOS, Android ve web arasında ortaktır.',
    path: '/login',
    noIndex: true,
  });

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    const result = await signInWithPassword(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.replace((next ?? '/feed') as Href);
  };

  return (
    <WebAuthLayout
      eyebrow="TEKRAR HOŞ GELDİN"
      title="Giriş yap"
      subtitle="Trabzone hesabınla devam et. Web, iOS ve Android aynı hesabı kullanır."
      footer={
        <View style={styles.footer}>
          <AppText variant="caption" color="textSecondary">
            Henüz hesabın yok mu?
          </AppText>
          <Link href={'/register' as Href} asChild>
            <Pressable>
              <AppText variant="caption" color="primary" style={styles.linkStrong}>
                Hesap oluştur
              </AppText>
            </Pressable>
          </Link>
        </View>
      }
    >
      {authStatus === 'authenticated' ? (
        <View style={[styles.notice, { backgroundColor: theme.colors.successSoft }]}>
          <Ionicons name="checkmark-circle-outline" size={18} color={theme.colors.success} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Zaten giriş yapmış görünüyorsun. Devam ederek hesabına geçebilirsin.
          </AppText>
          <Button
            label="Devam et"
            size="sm"
            onPress={() => router.replace((next ?? '/feed') as Href)}
            style={styles.smallButton}
          />
        </View>
      ) : null}

      <View style={styles.form}>
        <TextField
          label="E-posta"
          value={email}
          onChangeText={setEmail}
          placeholder="ornek@eposta.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          leftIcon="mail-outline"
          editable={!submitting}
        />
        <View>
          <TextField
            label="Şifre"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secure
            autoCapitalize="none"
            autoComplete="password"
            leftIcon="lock-closed-outline"
            editable={!submitting}
          />
          <View style={styles.forgotRow}>
            <Link href={'/forgot-password' as Href} asChild>
              <Pressable>
                <AppText variant="caption" color="primary">
                  Şifremi unuttum
                </AppText>
              </Pressable>
            </Link>
          </View>
        </View>

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={17} color={theme.colors.danger} />
            <AppText variant="caption" color="danger" style={styles.flex}>
              {error}
            </AppText>
          </View>
        ) : null}

        <Button
          label={submitting ? 'Giriş yapılıyor…' : 'Giriş Yap'}
          size="lg"
          loading={submitting}
          disabled={!email.trim() || !password}
          onPress={() => void submit()}
        />
      </View>

      <View style={styles.divider}>
        <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
        <AppText variant="caption" color="textTertiary">
          Sosyal giriş
        </AppText>
        <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
      </View>

      <View style={[styles.socialNote, { borderColor: theme.colors.border }]}>
        <Ionicons name="phone-portrait-outline" size={18} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textSecondary" style={styles.flex}>
          Apple ve Google ile giriş şu anda mobil uygulamada kullanılabilir. Web üzerinde e-posta
          ve şifre ile devam edebilirsin.
        </AppText>
      </View>

      <View style={styles.helpLinks}>
        <Link href={'/support' as Href} asChild>
          <Pressable>
            <AppText variant="caption" color="textSecondary">
              Giriş sorunu mu yaşıyorsun? Destek merkezi
            </AppText>
          </Pressable>
        </Link>
        <Link href={'/' as Href} asChild>
          <Pressable>
            <AppText variant="caption" color="textSecondary">
              Tanıtım sayfasına dön
            </AppText>
          </Pressable>
        </Link>
      </View>

      <AppText variant="caption" color="textTertiary" align="center" style={styles.legal}>
        Giriş yaparak Kullanım Koşulları ve Gizlilik Politikası&apos;nı kapsamında hesabına
        erişirsin. Mevcut kabul kayıtların korunur.
      </AppText>
    </WebAuthLayout>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: 16 },
  forgotRow: { alignItems: 'flex-end', marginTop: 8 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 10 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 },
  linkStrong: { fontWeight: '600' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10 },
  smallButton: { width: 100 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  socialNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  helpLinks: { alignItems: 'center', gap: 8 },
  legal: { lineHeight: 17 },
});
