import { Ionicons } from '@expo/vector-icons';
import { Link, type Href, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { env } from '@/config/env';
import { safeNextPath } from '@/features/auth/next-path';
import { finishSignUpFromMetadata } from '@/features/auth/signup-completion';
import { SavedAccountsPicker } from '@/features/auth/components/SavedAccountsPicker';
import { SocialAuthButtons } from '@/features/auth/components/SocialAuthButtons';
import {
  rememberAccount,
  useSavedAccounts,
  useSavedAccountsStore,
  type SavedAccount,
} from '@/features/auth/saved-accounts';
import { fetchPendingAcceptances } from '@/features/legal/services/legal-service';
import { fetchMyProfile } from '@/features/profile/services/profile-service';
import { signInWithPassword } from '@/services/supabase/auth';
import { useAuthStatus, useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import { useWebMeta } from '../use-web-meta';
import { WebAuthLayout } from './WebAuthLayout';

export function WebLoginPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const authStatus = useAuthStatus();
  const session = useSession();
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeNextPath(params.next);
  const submittedRef = useRef(false);
  const savedAccounts = useSavedAccounts();
  const forget = useSavedAccountsStore((state) => state.forget);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  // Oturum baska bir sekmede acildiysa veya oturum geri yuklenirken bu ekran
  // gorunduyse kullaniciyi bekletmeden hedefe tasi. Bu formdan yapilan giris
  // `submit` icinde yonlendirildigi icin burada tekrar ele alinmaz.
  useEffect(() => {
    if (next && authStatus === 'authenticated' && !submittedRef.current) {
      router.replace(next as Href);
    }
  }, [authStatus, next, router]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Kayıtlı hesaptan mı dolduruldu? Yalnızca bu durumda şifre alanında ipucu
  // gösterilir; kullanıcı e-postayı elle yazarsa ipucu kaybolur.
  const [autofilled, setAutofilled] = useState(false);

  useWebMeta({
    title: 'Trabzone Giriş',
    description:
      'Trabzone hesabına web üzerinden giriş yap. Aynı hesap iOS, Android ve web arasında ortaktır.',
    path: '/login',
    noIndex: true,
  });

  const submit = async () => {
    submittedRef.current = true;
    setError(null);
    setSubmitting(true);
    let signedIn = false;
    try {
      const result = await signInWithPassword(email, password);
      if (!result.ok) {
        setSubmitting(false);
        setError(result.error.message);
        return;
      }
      signedIn = true;
      setSubmitting(false);

      const [profile, pending] = await Promise.all([
        fetchMyProfile().catch(() => ({ ok: false }) as const),
        fetchPendingAcceptances().catch(() => ({ ok: false, data: [] }) as const),
      ]);
      // Başarılı giriş cihaza yazılır: bir sonraki gelişte avatarıyla listelenir.
      rememberAccount({
        id: result.data.user.id,
        email: result.data.user.email ?? email,
        name: profile.ok
          ? `${profile.data?.first_name ?? ''} ${profile.data?.last_name ?? ''}`.trim() || undefined
          : undefined,
        username: profile.ok ? profile.data?.username : undefined,
        avatarPath: profile.ok ? profile.data?.avatar_path : undefined,
      });
      if (profile.ok && !profile.data?.onboarding_completed) {
        // Kayıt sırasında verilen bilgiler duruyorsa profil tamamlama ekranı
        // yeniden gösterilmez; profil doğrudan tamamlanır.
        const destination = await finishSignUpFromMetadata();
        router.replace(destination);
        return;
      }
      if (pending.ok && (pending.data?.length ?? 0) > 0) {
        router.replace('/legal/consent');
        return;
      }
      router.replace((next ?? '/feed') as Href);
    } catch (cause) {
      // Giriş başarılıysa bile profil/onay okuması hata verebilir; kullanıcıyı
      // formda kilitli bırakmak yerine akışa devam ettirilir.
      setSubmitting(false);
      if (signedIn) {
        router.replace((next ?? '/feed') as Href);
        return;
      }
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : 'Giriş yapılamadı. Lütfen tekrar dene.',
      );
    }
  };

  // Kayıtlı hesaba dokunmak e-postayı doldurur. Oturumu hâlâ açık olan
  // hesapta tek dokunuş doğrudan uygulamaya geçirir (oturum koruma).
  const pickAccount = (account: SavedAccount) => {
    setError(null);
    setEmail(account.email);
    setPassword('');
    setAutofilled(true);
    if (authStatus === 'authenticated' && session?.user?.id === account.id) {
      submittedRef.current = true;
      router.replace((next ?? '/feed') as Href);
      return;
    }
    passwordRef.current?.focus();
  };

  const activeAccountShown =
    authStatus === 'authenticated' &&
    Boolean(session?.user?.id) &&
    savedAccounts.some((account) => account.id === session?.user?.id);

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
      {activeAccountShown ? null : authStatus === 'authenticated' ? (
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

      <SavedAccountsPicker
        accounts={savedAccounts}
        activeId={authStatus === 'authenticated' ? (session?.user?.id ?? null) : null}
        onPick={pickAccount}
        onForget={(account) => forget(account.id)}
      />

      <View style={styles.form}>
        <TextField
          label="E-posta"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setAutofilled(false);
          }}
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
            ref={passwordRef}
            hint={
              autofilled ? 'E-posta dolduruldu. Devam etmek için şifreni gir.' : undefined
            }
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

      {env.enableSocialAuth ? (
        <>
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <AppText variant="caption" color="textTertiary">
              veya
            </AppText>
            <View style={styles.dividerLine} />
          </View>
          <SocialAuthButtons />
        </>
      ) : null}

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
        Giriş yaparak Kullanım Koşulları ve Gizlilik Politikası kapsamında hesabına erişirsin.
        Mevcut kabul kayıtların korunur.
      </AppText>
    </WebAuthLayout>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.16)' },
  forgotRow: { alignItems: 'flex-end', marginTop: 8 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 10 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 },
  linkStrong: { fontWeight: '600' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10 },
  smallButton: { width: 100 },
  helpLinks: { alignItems: 'center', gap: 8 },
  legal: { lineHeight: 17 },
});
