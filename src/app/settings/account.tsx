import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Screen, ScreenHeader, TextField } from '@/components/ui';
import {
  changePassword,
  fetchAccountOverview,
  linkProvider,
  providerLabel,
  requestEmailChange,
  resendEmailVerification,
  unlinkProvider,
  type AccountOverview,
  type LinkedProvider,
} from '@/features/account/services/account-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { unwrap } from '@/utils/result';
import { socialAvailability } from '@/features/auth/social-availability';

type SocialRowProvider = Extract<LinkedProvider, 'apple' | 'google'>;

const SOCIAL_ROWS: { provider: SocialRowProvider; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { provider: 'apple', icon: 'logo-apple' },
  { provider: 'google', icon: 'logo-google' },
];

export default function AccountScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const account = useQuery<AccountOverview>({
    queryKey: ['account-overview'],
    queryFn: async () => {
      const result = await fetchAccountOverview();
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
  });

  const [emailDraft, setEmailDraft] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);

  const refreshAccount = () => {
    void queryClient.invalidateQueries({ queryKey: ['account-overview'] });
  };

  const emailMutation = useMutation({
    mutationFn: async (email: string) => unwrap(requestEmailChange(email)),
    onSuccess: () => {
      haptics.success();
      setEmailDraft('');
      setEmailError(null);
      Alert.alert(
        'Doğrulama gönderildi',
        'Yeni e-posta adresine bir onay bağlantısı gönderdik. Bağlantıya dokunduğunda değişiklik tamamlanır.',
      );
    },
    onError: (error: Error) => setEmailError(error.message),
  });

  const passwordMutation = useMutation({
    mutationFn: async (value: string) => unwrap(changePassword(value)),
    onSuccess: () => {
      haptics.success();
      setPassword('');
      setPasswordRepeat('');
      setPasswordError(null);
      Alert.alert('Şifre güncellendi', 'Yeni şifrenle giriş yapabilirsin.');
    },
    onError: (error: Error) => setPasswordError(error.message),
  });

  const verifyMutation = useMutation({
    mutationFn: async () => unwrap(resendEmailVerification()),
    onSuccess: () => {
      haptics.success();
      Alert.alert('Doğrulama gönderildi', 'E-posta adresine yeni bir doğrulama bağlantısı gönderdik.');
    },
    onError: (error: Error) => Alert.alert('Gönderilemedi', error.message),
  });

  const submitPassword = () => {
    if (password.length < 8) {
      setPasswordError('Şifre en az 8 karakter olmalı.');
      return;
    }
    if (password !== passwordRepeat) {
      setPasswordError('Şifreler birbiriyle eşleşmiyor.');
      return;
    }
    setPasswordError(null);
    passwordMutation.mutate(password);
  };

  const submitEmail = () => {
    const next = emailDraft.trim().toLowerCase();
    if (next === account.data?.email) {
      setEmailError('Bu zaten mevcut e-posta adresin.');
      return;
    }
    setEmailError(null);
    emailMutation.mutate(next);
  };

  const connect = (provider: LinkedProvider) => {
    setBusyProvider(provider);
    void (async () => {
      const result = await linkProvider(provider as 'apple' | 'google');
      setBusyProvider(null);
      if (!result.ok) {
        Alert.alert('Hesap ve güvenlik', result.error.message);
        return;
      }
      haptics.success();
      refreshAccount();
      Alert.alert('Bağlandı', `${providerLabel(provider)} hesabın profiline eklendi.`);
    })();
  };

  const disconnect = (provider: LinkedProvider) => {
    Alert.alert(
      'Bağlantıyı kes',
      `${providerLabel(provider)} girişini kaldırmak istediğine emin misin? Bu yöntemle artık giriş yapamazsın.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Bağlantıyı kes',
          style: 'destructive',
          onPress: () => {
            setBusyProvider(provider);
            void (async () => {
              const result = await unlinkProvider(provider);
              setBusyProvider(null);
              if (!result.ok) {
                Alert.alert('Hesap ve güvenlik', result.error.message);
                return;
              }
              haptics.selection();
              refreshAccount();
            })();
          },
        },
      ],
    );
  };

  const providers = account.data?.providers ?? [];
  // Bu platformda açılamayan sağlayıcı satırı gizlenir; ancak hesaba zaten
  // bağlıysa bağlantıyı kesebilmek için görünür kalır.
  const socialAvailabilityByProvider = socialAvailability();
  const socialRows = SOCIAL_ROWS.filter(
    (row) => socialAvailabilityByProvider[row.provider] || providers.includes(row.provider),
  );

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <ScreenHeader
        title="Hesap ve güvenlik"
        subtitle="Giriş yöntemleri, e-posta ve şifre"
        onBack={() => router.back()}
      />

      {account.isLoading ? (
        <Card style={styles.stateCard}>
          <AppText variant="body" color="textSecondary">
            Hesap bilgileri yükleniyor…
          </AppText>
        </Card>
      ) : account.isError || !account.data ? (
        <Card style={styles.stateCard}>
          <Ionicons name="cloud-offline-outline" size={24} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            Hesap bilgileri yüklenemedi.
          </AppText>
          <Button label="Tekrar dene" variant="secondary" onPress={() => void account.refetch()} />
        </Card>
      ) : (
        <>
          <Card style={styles.emailCard}>
            <View style={[styles.emailIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="mail-outline" size={20} color={theme.colors.primaryDeep} />
            </View>
            <View style={styles.flex}>
              <AppText variant="caption" color="textTertiary">
                Profilde görünen e-posta
              </AppText>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {account.data.email ?? 'E-posta bağlı değil'}
              </AppText>
            </View>
            <View
              style={[
                styles.verifiedPill,
                {
                  backgroundColor: account.data.emailVerified
                    ? theme.colors.successSoft
                    : theme.colors.warningSoft,
                },
              ]}
            >
              <Ionicons
                name={account.data.emailVerified ? 'checkmark-circle' : 'alert-circle'}
                size={13}
                color={account.data.emailVerified ? theme.colors.success : theme.colors.warning}
              />
              <AppText
                variant="caption"
                color={account.data.emailVerified ? 'success' : 'warning'}
              >
                {account.data.emailVerified ? 'Doğrulandı' : 'Doğrulanmadı'}
              </AppText>
            </View>
          </Card>

          {!account.data.emailVerified ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Doğrulama bağlantısı gönder"
              onPress={() => verifyMutation.mutate()}
              style={({ pressed }) => [
                styles.verifyBanner,
                {
                  backgroundColor: theme.colors.warningSoft,
                  borderColor: theme.colors.warning,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Ionicons name="shield-outline" size={17} color={theme.colors.warning} />
              <AppText variant="caption" color="warning" style={styles.flex}>
                E-postanı doğrulayarak hesabını güvenceye al. Doğrulama bağlantısı gönder.
              </AppText>
              <Ionicons name="chevron-forward" size={15} color={theme.colors.warning} />
            </Pressable>
          ) : null}

          <View style={styles.section}>
            <AppText variant="h3">Giriş yöntemleri</AppText>
            <Card padding={0}>
              <ProviderRow
                icon="mail-outline"
                label={providerLabel('email')}
                detail={account.data.email ?? 'Bağlı değil'}
                connected={providers.includes('email')}
                locked
              />
              {socialRows.map((row) => {
                const connected = providers.includes(row.provider);
                const busy = busyProvider === row.provider;
                return (
                  <ProviderRow
                    key={row.provider}
                    icon={row.icon}
                    label={providerLabel(row.provider)}
                    detail={connected ? 'Bağlı' : 'Bağlı değil'}
                    connected={connected}
                    loading={busy}
                    onPress={() =>
                      connected ? disconnect(row.provider) : connect(row.provider)
                    }
                  />
                );
              })}
            </Card>
            <AppText variant="caption" color="textTertiary" style={styles.sectionNote}>
              Bağlı hesaplarla tek dokunuşla giriş yapabilirsin. Bağlantıyı kestiğinde yalnızca o
              sağlayıcı kaldırılır; Trabzone hesabın ve içeriklerin korunur.
            </AppText>
          </View>

          <View style={styles.section}>
            <AppText variant="h3">E-postayı değiştir</AppText>
            <Card style={styles.formCard}>
              <TextField
                label="Yeni e-posta"
                placeholder="ornek@eposta.com"
                value={emailDraft}
                onChangeText={(text) => {
                  setEmailDraft(text);
                  setEmailError(null);
                }}
                error={emailError}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                leftIcon="mail-outline"
                hint="Değişiklik, yeni adrese gönderilen doğrulama bağlantısı onaylanınca tamamlanır."
              />
              <Button
                label="Doğrulama bağlantısı gönder"
                variant="secondary"
                onPress={submitEmail}
                loading={emailMutation.isPending}
                disabled={emailDraft.trim().length === 0}
              />
            </Card>
          </View>

          <View style={styles.section}>
            <AppText variant="h3">Şifreyi değiştir</AppText>
            <Card style={styles.formCard}>
              <TextField
                label="Yeni şifre"
                placeholder="En az 8 karakter"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setPasswordError(null);
                }}
                secure
                autoCapitalize="none"
                leftIcon="lock-closed-outline"
              />
              <TextField
                label="Yeni şifre (tekrar)"
                placeholder="Şifreyi yeniden gir"
                value={passwordRepeat}
                onChangeText={(text) => {
                  setPasswordRepeat(text);
                  setPasswordError(null);
                }}
                secure
                autoCapitalize="none"
                leftIcon="lock-closed-outline"
                error={passwordError}
              />
              <Button
                label="Şifreyi güncelle"
                onPress={submitPassword}
                loading={passwordMutation.isPending}
                disabled={password.length === 0}
              />
            </Card>
            <AppText variant="caption" color="textTertiary" style={styles.sectionNote}>
              Yalnızca e-posta ve şifreyle giriş yapıyorsan şifreni buradan belirleyebilirsin. Apple
              veya Google ile giriş yapan hesaplarda şifre, o sağlayıcıya ek bir giriş yöntemi olur.
            </AppText>
          </View>
        </>
      )}
    </Screen>
  );
}

function ProviderRow({
  icon,
  label,
  detail,
  connected,
  locked = false,
  loading = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail: string;
  connected: boolean;
  locked?: boolean;
  loading?: boolean;
  onPress?: () => void;
}) {
  const { theme } = useTheme();

  return (
    <View style={[styles.providerRow, { borderBottomColor: theme.colors.divider }]}>
      <View style={[styles.providerIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name={icon} size={19} color={theme.colors.text} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{label}</AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {detail}
        </AppText>
      </View>
      {locked ? (
        <View style={[styles.lockPill, { backgroundColor: theme.colors.surfaceMuted }]}>
          <AppText variant="caption" color="textTertiary">
            {connected ? 'Ana giriş' : 'Bağlı değil'}
          </AppText>
        </View>
      ) : (
        <Button
          label={connected ? 'Bağlantıyı kes' : 'Bağla'}
          variant={connected ? 'outline' : 'secondary'}
          size="sm"
          fullWidth={false}
          loading={loading}
          onPress={onPress}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stateCard: { alignItems: 'center', gap: 10 },
  emailCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emailIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  verifyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
  },
  section: { marginTop: 22, gap: 8 },
  sectionNote: { paddingHorizontal: 4, lineHeight: 16 },
  formCard: { gap: 12 },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 62,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  providerIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  lockPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
});
