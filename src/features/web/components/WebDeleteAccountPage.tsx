import { Ionicons } from '@expo/vector-icons';
import { Link, type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, TextField } from '@/components/ui';
import {
  useDeleteAccount,
  useDeletionStatus,
} from '@/features/account/hooks/use-account-deletion';
import {
  useCreateDeletionRequest,
  useDeletionRequestStatus,
} from '@/features/account/hooks/use-deletion-request';
import type { DeletionReceipt } from '@/features/account/services/account-deletion-service';
import type { DeletionRequestReceipt } from '@/features/account/services/deletion-request-service';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useAuthStore } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';

import { useWebMeta } from '../use-web-meta';
import { WebFooter } from './WebFooter';
import { WebHeader } from './WebHeader';

const DELETED_ITEMS = [
  'Profil bilgileri, profil ve kapak fotoğrafı',
  'Gönderiler, hikâyeler, Reels videoları, yorum ve beğeniler',
  'Takip ilişkileri, favoriler ve engel listesi',
  'Marketplace ilanları ve işletme katkıları',
  'Yüklediğin medya dosyaları',
  'Mesajlar (karşı tarafın geçmişi için anonimleştirilir)',
  'Bildirim tercihleri ve aktif oturumlar',
];

const KEPT_ITEMS = [
  'Destek ve moderasyon kayıtları yalnızca yasal saklama süresi boyunca sınırlı tutulur.',
  'Silme işlemine ait referans kodu ve işlem adımları denetim amacıyla saklanır.',
  'Yasal yükümlülük gerektiren işlem kayıtları kimliksizleştirilerek korunur.',
];

const STATUS_LABELS: Record<string, string> = {
  received: 'Talep alındı',
  processing: 'İşlemde',
  retry_scheduled: 'Yeniden denenecek',
  failed: 'İşlem başarısız',
  completed: 'Tamamlandı',
};

function FieldLabel({ children }: { children: string }) {
  return (
    <AppText variant="caption" color="textSecondary" style={styles.fieldLabel}>
      {children}
    </AppText>
  );
}

/**
 * Web hesap silme merkezi.
 *
 * Oturum açmış kullanıcı hesabını doğrudan silebilir. Oturum açamayan
 * kullanıcı ise yalnızca talep oluşturur; bu talep e-posta tek başına
 * doğrulama sayılmadan yetkili personel tarafından incelenir.
 */
export function WebDeleteAccountPage() {
  const { theme } = useTheme();
  const session = useAuthStore((state) => state.session);
  const signOut = useAuthStore((state) => state.signOut);
  const isAuthed = Boolean(session?.user);

  useWebMeta({
    title: 'Trabzone Hesap Silme',
    description:
      'Trabzone hesabını web üzerinden kalıcı olarak sil veya giriş yapamıyorsan güvenli hesap silme talebi oluştur.',
    path: '/delete-account',
  });

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <WebHeader />
      <View style={styles.hero}>
        <View style={styles.heroInner}>
          <AppText variant="caption" color="#8EA6D8" style={styles.eyebrow}>
            HESAP VE VERİ YÖNETİMİ
          </AppText>
          <AppText
            variant="h1"
            color="#FFFFFF"
            style={styles.heroTitle}
            accessibilityRole="header"
          >
            Hesap Silme
          </AppText>
          <AppText variant="body" color="#A9BDE2" style={styles.heroSummary}>
            Hesabını kalıcı olarak silebilir veya giriş yapamıyorsan kimlik doğrulaması gerektiren
            bir silme talebi oluşturabilirsin.
          </AppText>
          <View style={styles.pillRow}>
            <View style={styles.heroPill}>
              <Ionicons name="trash-outline" size={13} color="#A8BEE8" />
              <AppText variant="caption" color="#C9D7F0">
                Kalıcı silme
              </AppText>
            </View>
            <View style={styles.heroPill}>
              <Ionicons name="shield-checkmark-outline" size={13} color="#A8BEE8" />
              <AppText variant="caption" color="#C9D7F0">
                Güvenli kimlik doğrulama
              </AppText>
            </View>
            <View style={styles.heroPill}>
              <Ionicons name="mail-outline" size={13} color="#A8BEE8" />
              <AppText variant="caption" color="#C9D7F0">
                Referans kodu ile takip
              </AppText>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.mainColumn}>
          {isAuthed ? <AuthenticatedDeletion onSignedOut={() => void signOut()} /> : <GuestDeletionRequest />}

          <Card tone="muted" elevated={false} style={styles.infoCard}>
            <AppText variant="bodyStrong">Hesap dondurma ile farkı</AppText>
            <AppText variant="body" color="textSecondary">
              Hesabını yalnızca devre dışı bırakmak istiyorsan çıkış yapman yeterlidir. Bu sayfadaki
              işlem geri alınamaz ve aynı hesapla tekrar giriş yapılamaz. Yeni bir hesap açmak
              mümkündür ancak eski içerikler geri getirilemez.
            </AppText>
          </Card>
        </View>

        <View style={styles.sideColumn}>
          <Card style={styles.sideCard}>
            <AppText variant="overline" color="textTertiary">
              SİLİNECEK VERİLER
            </AppText>
            {DELETED_ITEMS.map((item) => (
              <Bullet key={item} text={item} tone="danger" />
            ))}
          </Card>
          <Card tone="muted" elevated={false} style={styles.sideCard}>
            <AppText variant="overline" color="textTertiary">
              SINIRLI SAKLANAN KAYITLAR
            </AppText>
            {KEPT_ITEMS.map((item) => (
              <Bullet key={item} text={item} tone="muted" />
            ))}
          </Card>
          <Card tone="muted" elevated={false} style={styles.sideCard}>
            <AppText variant="bodyStrong">Yardım mı gerekiyor?</AppText>
            <AppText variant="caption" color="textSecondary">
              Silme süreciyle ilgili sorularını destek ekibine iletebilirsin.
            </AppText>
            <Link href={'/support' as Href} asChild>
              <Button label="Destek Merkezi" variant="secondary" size="sm" />
            </Link>
          </Card>
        </View>
      </View>
      <WebFooter />
    </View>
  );
}

function AuthenticatedDeletion({ onSignedOut }: { onSignedOut: () => void }) {
  const { theme } = useTheme();
  const router = useRouter();
  const { data: profile } = useMyProfile();
  const { data: deletionStatus } = useDeletionStatus();
  const deleteAccount = useDeleteAccount();
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<DeletionReceipt | null>(null);

  const username = profile?.username ?? '';
  const confirmed = username.length > 0 && confirm.trim().toLowerCase() === username.toLowerCase();
  const canSubmit = confirmed && ack && !deleteAccount.isPending;

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    deleteAccount.mutate(
      { confirm: confirm.trim(), password: password || null, reason: reason || null },
      {
        onSuccess: (data) => {
          setReceipt(data);
        },
        onError: (mutationError) => setError(mutationError.message),
      },
    );
  };

  if (receipt) {
    return (
      <Card style={styles.receiptCard}>
        <View style={[styles.successIcon, { backgroundColor: theme.colors.successSoft }]}>
          <Ionicons name="checkmark-circle" size={30} color={theme.colors.success} />
        </View>
        <AppText variant="h2">Hesabın kalıcı olarak silindi</AppText>
        <AppText variant="body" color="textSecondary">
          Profilin, içeriklerin ve medya dosyaların kaldırıldı; oturumların kapatıldı. Bu hesapla
          tekrar giriş yapılamaz.
        </AppText>
        <View style={[styles.referenceBox, { backgroundColor: theme.colors.surfaceMuted }]}>
          <AppText variant="caption" color="textTertiary">
            Silme referans kodun
          </AppText>
          <AppText variant="title" selectable>
            {receipt.reference_code}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            Bu kodu saklayabilirsin. Yasal saklama kapsamındaki kayıtlar kimliksizleştirilerek
            tutulur.
          </AppText>
        </View>
        <Button
          label="Ana sayfaya dön"
          onPress={() => {
            onSignedOut();
            router.replace('/');
          }}
        />
      </Card>
    );
  }

  return (
    <Card style={styles.actionCard}>
      <View style={styles.accountRow}>
        <View style={[styles.accountIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="person-outline" size={20} color={theme.colors.primaryDeep} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">Silinecek hesap</AppText>
          <AppText variant="caption" color="textSecondary">
            {profile?.username ? `@${profile.username}` : 'Hesap bilgisi yükleniyor…'}
          </AppText>
        </View>
        <View style={[styles.badge, { backgroundColor: theme.colors.successSoft }]}>
          <AppText variant="caption" color="success">
            Oturum doğrulandı
          </AppText>
        </View>
      </View>

      {deletionStatus?.request && deletionStatus.request.status !== 'completed' ? (
        <View style={[styles.warningBox, { borderColor: theme.colors.warning }]}>
          <Ionicons name="time-outline" size={18} color={theme.colors.warning} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Devam eden bir silme talebin var: {deletionStatus.request.reference_code} ·{' '}
            {STATUS_LABELS[deletionStatus.request.status] ?? deletionStatus.request.status}
          </AppText>
        </View>
      ) : null}

      <View style={[styles.dangerBox, { borderColor: theme.colors.danger }]}>
        <View style={styles.warningHead}>
          <Ionicons name="warning-outline" size={20} color={theme.colors.danger} />
          <AppText variant="bodyStrong" color="danger">
            Bu işlem geri alınamaz
          </AppText>
        </View>
        <AppText variant="body" color="textSecondary">
          Devam ettiğinde hesabın ve ilişkili verilerin silinir. İşlem tamamlanmadan önce
          vazgeçme şansın yoktur.
        </AppText>
      </View>

      <View style={styles.form}>
        <View>
          <FieldLabel>Onay için kullanıcı adını yaz</FieldLabel>
          <TextField
            value={confirm}
            onChangeText={setConfirm}
            placeholder={username ? `@${username}` : 'kullanıcı adın'}
            autoCapitalize="none"
            autoCorrect={false}
            leftIcon="at-outline"
          />
        </View>
        <View>
          <FieldLabel>Şifren (e-posta ile giriş yaptıysan zorunlu)</FieldLabel>
          <TextField
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secure
            autoCapitalize="none"
            leftIcon="lock-closed-outline"
            hint="Google veya Apple ile giriş yaptıysan şifre alanını boş bırakabilirsin."
          />
        </View>
        <View>
          <FieldLabel>Silme nedeni (isteğe bağlı)</FieldLabel>
          <TextField
            value={reason}
            onChangeText={setReason}
            placeholder="Neden ayrılıyorsun?"
            multiline
            numberOfLines={3}
            maxLength={500}
          />
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: ack }}
          onPress={() => setAck((value) => !value)}
          style={styles.checkboxRow}
        >
          <View
            style={[
              styles.checkbox,
              {
                borderColor: ack ? theme.colors.danger : theme.colors.border,
                backgroundColor: ack ? theme.colors.danger : 'transparent',
              },
            ]}
          >
            {ack ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}
          </View>
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Hesabımın ve ilişkili verilerimin kalıcı olarak silineceğini, bu işlemin geri alınamaz
            olduğunu okudum ve onaylıyorum.
          </AppText>
        </Pressable>

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
            <AppText variant="caption" color="danger" style={styles.flex}>
              {error}
            </AppText>
          </View>
        ) : null}

        <Button
          label={deleteAccount.isPending ? 'Hesap siliniyor…' : 'Hesabımı kalıcı olarak sil'}
          variant="danger"
          loading={deleteAccount.isPending}
          disabled={!canSubmit}
          onPress={submit}
        />
        <AppText variant="caption" color="textTertiary" align="center">
          Silme işlemi sunucuda çalışır. Başarısız olursa hesabın silinmiş sayılmaz ve hata
          gösterilir.
        </AppText>
      </View>
    </Card>
  );
}

function GuestDeletionRequest() {
  const { theme } = useTheme();
  const createRequest = useCreateDeletionRequest();
  const checkStatus = useDeletionRequestStatus();
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState<DeletionRequestReceipt | null>(null);
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupNo, setLookupNo] = useState('');
  const [lookupResult, setLookupResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    createRequest.mutate(
      { email, reason: reason || null },
      {
        onSuccess: (data) => {
          setReceipt(data);
          setLookupEmail(email.trim());
          setLookupNo(data.request_no);
        },
        onError: (mutationError) => setError(mutationError.message),
      },
    );
  };

  const lookup = () => {
    setLookupResult(null);
    checkStatus.mutate(
      { requestNo: lookupNo, email: lookupEmail },
      {
        onSuccess: (data) => {
          if (!data) {
            setLookupResult('Bu bilgilerle eşleşen bir talep bulunamadı.');
            return;
          }
          setLookupResult(
            `${data.request_no} · ${STATUS_LABELS[data.status] ?? data.status} · ${formatDateTr(
              data.created_at,
            )}${data.identity_verified ? ' · Kimlik doğrulandı' : ''}`,
          );
        },
        onError: (mutationError) => setLookupResult(mutationError.message),
      },
    );
  };

  if (receipt) {
    return (
      <Card style={styles.actionCard}>
        <View style={[styles.successIcon, { backgroundColor: theme.colors.successSoft }]}>
          <Ionicons name="mail-unread-outline" size={28} color={theme.colors.success} />
        </View>
        <AppText variant="h2">Silme talebin alındı</AppText>
        <AppText variant="body" color="textSecondary">
          Talebin güvenli kimlik doğrulama için incelenecek. Kayıtlı e-posta adresine bilgilendirme
          gönderilir. E-posta adresi tek başına silme işlemi başlatmaz.
        </AppText>
        <View style={[styles.referenceBox, { backgroundColor: theme.colors.surfaceMuted }]}>
          <AppText variant="caption" color="textTertiary">
            Talep referans kodun
          </AppText>
          <AppText variant="title" selectable>
            {receipt.request_no}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {receipt.rate_limited
              ? '24 saat içinde birden fazla talep oluşturuldu. En son talebin gösteriliyor.'
              : 'Bu kodu ve e-posta adresini sakla; durum sorgulamak için gerekir.'}
          </AppText>
        </View>
        <Link href={'/support' as Href} asChild>
          <Button label="Destek Merkezi" variant="secondary" />
        </Link>
      </Card>
    );
  }

  return (
    <>
      <Card style={styles.actionCard}>
        <View style={styles.accountRow}>
          <View style={[styles.accountIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="help-circle-outline" size={20} color={theme.colors.primaryDeep} />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Hesabına giriş yapamıyor musun?</AppText>
            <AppText variant="caption" color="textSecondary">
              Uygulamayı yeniden yüklemek zorunda kalmadan silme talebi oluşturabilirsin.
            </AppText>
          </View>
        </View>

        <View style={[styles.warningBox, { borderColor: theme.colors.warning }]}>
          <Ionicons name="information-circle-outline" size={18} color={theme.colors.warning} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Güvenlik nedeniyle yalnızca e-posta adresi girerek hesap silinemez. Talep, yetkili
            ekip tarafından kimlik doğrulaması yapıldıktan sonra işlenir.
          </AppText>
        </View>

        <View style={styles.form}>
          <View>
            <FieldLabel>Hesabına kayıtlı e-posta</FieldLabel>
            <TextField
              value={email}
              onChangeText={setEmail}
              placeholder="ornek@eposta.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              leftIcon="mail-outline"
            />
          </View>
          <View>
            <FieldLabel>Ek açıklama (isteğe bağlı)</FieldLabel>
            <TextField
              value={reason}
              onChangeText={setReason}
              placeholder="Talebinle ilgili kısa bir açıklama"
              multiline
              numberOfLines={3}
              maxLength={500}
            />
          </View>
          {error ? (
            <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.flex}>
                {error}
              </AppText>
            </View>
          ) : null}
          <Button
            label={createRequest.isPending ? 'Talep oluşturuluyor…' : 'Silme talebi oluştur'}
            loading={createRequest.isPending}
            disabled={!email.trim()}
            onPress={submit}
          />
          <AppText variant="caption" color="textTertiary" align="center">
            Talebin durumunu referans kodu ve e-posta adresinle aşağıdan sorgulayabilirsin.
          </AppText>
        </View>
      </Card>

      <Card style={styles.actionCard}>
        <AppText variant="bodyStrong">Talep durumu sorgula</AppText>
        <AppText variant="caption" color="textSecondary">
          Referans kodunu ve talebi oluştururken kullandığın e-posta adresini gir.
        </AppText>
        <View style={styles.lookupRow}>
          <View style={styles.lookupField}>
            <TextField
              value={lookupNo}
              onChangeText={setLookupNo}
              placeholder="DEL-2026-000123"
              autoCapitalize="characters"
              leftIcon="pricetag-outline"
            />
          </View>
          <View style={styles.lookupField}>
            <TextField
              value={lookupEmail}
              onChangeText={setLookupEmail}
              placeholder="ornek@eposta.com"
              keyboardType="email-address"
              autoCapitalize="none"
              leftIcon="mail-outline"
            />
          </View>
          <Button
            label="Sorgula"
            variant="secondary"
            size="sm"
            loading={checkStatus.isPending}
            onPress={lookup}
            style={styles.lookupButton}
          />
        </View>
        {lookupResult ? (
          <View style={[styles.lookupResult, { backgroundColor: theme.colors.surfaceMuted }]}>
            <AppText variant="caption" color="textSecondary">
              {lookupResult}
            </AppText>
          </View>
        ) : null}
      </Card>
    </>
  );
}

function Bullet({ text, tone }: { text: string; tone: 'danger' | 'muted' }) {
  const { theme } = useTheme();
  return (
    <View style={styles.bulletRow}>
      <View
        style={[
          styles.bullet,
          { backgroundColor: tone === 'danger' ? theme.colors.danger : theme.colors.textTertiary },
        ]}
      />
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  hero: { backgroundColor: '#07152E', paddingTop: 56, paddingBottom: 44, paddingHorizontal: 20 },
  heroInner: { width: '100%', maxWidth: 1160, alignSelf: 'center' },
  eyebrow: { letterSpacing: 1.6, marginBottom: 10 },
  heroTitle: { maxWidth: 760 },
  heroSummary: { marginTop: 12, maxWidth: 700, lineHeight: 24 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  body: {
    width: '100%',
    maxWidth: 1160,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 50,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
  },
  mainColumn: { flex: 1, minWidth: 300, maxWidth: 760, gap: 20 },
  sideColumn: { width: 320, gap: 16 },
  actionCard: { gap: 16, padding: 22 },
  receiptCard: { gap: 14, padding: 22 },
  successIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  accountIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  dangerBox: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  warningHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  form: { gap: 14 },
  fieldLabel: { marginBottom: 6 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 10 },
  referenceBox: { gap: 6, padding: 16, borderRadius: 14 },
  infoCard: { gap: 8, padding: 20 },
  sideCard: { gap: 10, padding: 18 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bullet: { width: 5, height: 5, borderRadius: 3, marginTop: 7 },
  lookupRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' },
  lookupField: { flex: 1, minWidth: 180 },
  lookupButton: { width: 110 },
  lookupResult: { padding: 12, borderRadius: 10 },
});
