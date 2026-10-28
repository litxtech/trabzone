import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Screen, ScreenHeader, TextField } from '@/components/ui';
import { useDeleteAccount, useDeletionStatus } from '@/features/account/hooks/use-account-deletion';
import type {
  DeletionReceipt,
  DeletionStep,
} from '@/features/account/services/account-deletion-service';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useAuthStore } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

/**
 * Hesap silme ekrani.
 *
 * Akis: medya dosyalari Storage API ile silinir -> sunucu hesabi kalici olarak
 * siler -> makbuz (referans kodu) gosterilir -> oturum kapatilir.
 * Sunucu; sifre hatasi, kalan medya veya son yonetici durumunda silmeyi
 * reddeder ve hicbir veri kaldirilmaz.
 */
const REASONS = [
  'Artık kullanmıyorum',
  'Gizlilik endişesi',
  'Başka bir hesap açtım',
  'Çok fazla zaman alıyor',
  'Beklediğim deneyimi bulamadım',
] as const;

const DELETED_ITEMS = [
  'Profil fotoğrafın, kapak fotoğrafın ve biyografin',
  'Profilin, kullanıcı adın ve görünen tüm hesap bilgilerin',
  'Gönderilerin, hikâyelerin, Reels videoların, yorum ve beğenilerin',
  'Sohbette paylaştığın fotoğraf, video ve ses dosyaları',
  'Marketplace ilanların, favorilerin ve sipariş taleplerin',
  'Takipçilerin, takip ettiklerin ve engel listelerin',
  'Yüklediğin tüm medya dosyaları (bulut deposu dahil)',
  'Apple ile giriş yaptıysan Apple kimlik bağlantın (uygulama yetkisi geri alınır)',
  'Bildirim tercihlerin ve aktif oturumların',
];

const KEPT_ITEMS = [
  'Destek ve moderasyon kayıtları yasal saklama süresi boyunca sınırlı olarak tutulur.',
  'Silme işlemine ait referans kodu, durum sorgusu için saklanır.',
  'Yasal yükümlülük gerektiren işlem kayıtları kimliksizleştirilerek korunur.',
];

export default function DeleteAccountScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const signOut = useAuthStore((state) => state.signOut);
  const { data: profile } = useMyProfile();
  const { data: status } = useDeletionStatus();

  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<DeletionReceipt | null>(null);
  const [step, setStep] = useState<DeletionStep | null>(null);

  const deleteAccount = useDeleteAccount(setStep);

  const username = profile?.username ?? '';
  const confirmed = username.length > 0 && confirm.trim().toLowerCase() === username.toLowerCase();
  const pending = deleteAccount.isPending;
  const pendingLabel =
    step === 'verifying'
      ? 'Hesap doğrulanıyor…'
      : step === 'apple'
        ? 'Apple oturum bağlantın kaldırılıyor…'
        : step === 'media'
          ? 'Medya dosyaların siliniyor…'
          : step === 'account'
            ? 'Hesabın siliniyor…'
            : 'Hesap siliniyor…';

  const run = () => {
    setError(null);
    deleteAccount.mutate(
      { confirm: confirm.trim(), password: password || null, reason },
      {
        onSuccess: (data) => {
          haptics.success();
          setReceipt(data);
        },
        onError: (mutationError) => {
          haptics.error();
          setError(mutationError.message);
        },
      },
    );
  };

  const askConfirmation = () => {
    if (!confirmed || pending) {
      return;
    }
    haptics.warning();
    const title = 'Hesabını kalıcı olarak sil';
    const message =
      'Profilin, gönderilerin, mesajların ve ilanların silinecek. Bu işlem geri alınamaz. Devam etmek istiyor musun?';

    if (Platform.OS === 'web') {
      const accepted =
        typeof window === 'undefined' ? false : window.confirm(`${title}\n\n${message}`);
      if (accepted) {
        run();
      }
      return;
    }

    Alert.alert(title, message, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Kalıcı olarak sil', style: 'destructive', onPress: run },
    ]);
  };

  const leave = async () => {
    try {
      await signOut();
    } finally {
      router.replace('/lobby');
    }
  };

  if (receipt) {
    return (
      <Screen edges={['top', 'left', 'right']} scroll padded>
        <ScreenHeader title="Hesabın silindi" onBack={() => void leave()} />
        <Card style={styles.successCard}>
          <View style={[styles.successIcon, { backgroundColor: theme.colors.successSoft }]}>
            <Ionicons name="checkmark-circle" size={30} color={theme.colors.success} />
          </View>
          <AppText variant="title">Hesabın kalıcı olarak silindi</AppText>
          <AppText variant="body" color="textSecondary">
            Profilin, profil fotoğrafın, kapak fotoğrafın, içeriklerin ve medya dosyaların
            kaldırıldı, oturumların kapatıldı. Bu hesapla tekrar giriş yapılamaz.
          </AppText>

          <View
            style={[
              styles.referenceBox,
              { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md },
            ]}
          >
            <AppText variant="caption" color="textTertiary">
              Silme referans kodun
            </AppText>
            <AppText variant="title" selectable>
              {receipt.reference_code}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              Bu kodu destek ekibine ileterek silme durumunu sorgulayabilirsin.
            </AppText>
          </View>

          <Button label="Lobiye dön" onPress={() => void leave()} haptic="press" />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded>
      <ScreenHeader
        title="Hesabımı sil"
        subtitle="Bu işlem geri alınamaz"
        onBack={() => router.back()}
      />

      <View
        style={[
          styles.warning,
          {
            backgroundColor: theme.colors.dangerSoft,
            borderColor: theme.colors.danger,
            borderRadius: theme.radius.lg,
          },
        ]}
      >
        <View style={styles.warningHead}>
          <Ionicons name="warning-outline" size={20} color={theme.colors.danger} />
          <AppText variant="bodyStrong" color="danger">
            Silme işlemi kalıcıdır
          </AppText>
        </View>
        <AppText variant="body" color="textSecondary">
          Hesabını sildiğinde aynı e-posta veya kullanıcı adıyla yeni bir hesap açabilirsin; ancak
          eski içeriklerine erişemezsin. Giriş yapamıyorsan tarayıcıdan
          trabzoneapp.com/delete-account adresinden silme talebi oluşturabilirsin; uygulamayı
          yeniden yüklemen gerekmez.
        </AppText>
      </View>

      {status?.request && status.request.status !== 'completed' ? (
        <Card tone="muted" elevated={false} style={styles.pendingCard}>
          <AppText variant="bodyStrong">Devam eden bir silme talebin var</AppText>
          <AppText variant="caption" color="textSecondary">
            Referans: {status.request.reference_code} · Durum: {status.request.status}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            Formu yeniden gönderirsen işlem kaldığı yerden devam eder.
          </AppText>
        </Card>
      ) : null}

      <View style={styles.section}>
        <AppText variant="h3">Neler silinecek?</AppText>
        <Card style={styles.list}>
          {DELETED_ITEMS.map((item) => (
            <View key={item} style={styles.listRow}>
              <Ionicons name="trash-outline" size={15} color={theme.colors.danger} />
              <AppText variant="body" color="textSecondary" style={styles.flex}>
                {item}
              </AppText>
            </View>
          ))}
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="h3">Neler saklanır?</AppText>
        <Card style={styles.list}>
          {KEPT_ITEMS.map((item) => (
            <View key={item} style={styles.listRow}>
              <Ionicons name="archive-outline" size={15} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                {item}
              </AppText>
            </View>
          ))}
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="h3">Silme nedeni (isteğe bağlı)</AppText>
        <View style={styles.chips}>
          {REASONS.map((option) => {
            const selected = reason === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: pending }}
                disabled={pending}
                onPress={() => {
                  haptics.selection();
                  setReason(selected ? null : option);
                }}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <AppText variant="caption" color={selected ? 'primaryDeep' : 'textSecondary'}>
                  {option}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="h3">Onayla</AppText>
        <TextField
          label="Şifren"
          hint="Google/Apple ile giriş yaptıysan bu alanı boş bırakabilirsin."
          placeholder="Hesap şifren"
          secure
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          editable={!pending}
          leftIcon="lock-closed-outline"
        />
        <TextField
          label="Onay için kullanıcı adını yaz"
          hint={username ? `Yazman gereken: ${username}` : undefined}
          placeholder={username || 'kullanıcı adı'}
          value={confirm}
          onChangeText={setConfirm}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
          leftIcon="at-outline"
        />
        <AppText variant="caption" color="textTertiary">
          Silme işlemi öncesinde hesabına ait tüm medya dosyaları (profil fotoğrafı, kapak, gönderi
          ve sohbet dosyaları) bulut deposundan da kaldırılır. Bu yüzden işlem birkaç saniye
          sürebilir. İşlemi uygulamayı yeniden yükleyerek veya destek ekibine yazarak tekrarlaman
          gerekmez.
        </AppText>
      </View>

      {error ? (
        <View
          style={[
            styles.errorBox,
            { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
          ]}
        >
          <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
          <AppText variant="caption" color="danger" style={styles.flex}>
            {error}
          </AppText>
        </View>
      ) : null}

      <Button
        label={pending ? pendingLabel : 'Hesabımı kalıcı olarak sil'}
        variant="danger"
        loading={pending}
        disabled={!confirmed || pending}
        onPress={askConfirmation}
      />
      <Button
        label="Vazgeç"
        variant="ghost"
        disabled={pending}
        onPress={() => router.back()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  warning: { padding: 14, borderWidth: 1, gap: 8, marginTop: 6 },
  warningHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingCard: { gap: 5, marginTop: 14 },
  section: { gap: 9, marginTop: 20 },
  list: { gap: 9 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  successCard: { alignItems: 'center', gap: 10, marginTop: 20 },
  successIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  referenceBox: { alignSelf: 'stretch', padding: 14, gap: 4, alignItems: 'center', marginTop: 4 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 16,
    marginBottom: 10,
  },
});
