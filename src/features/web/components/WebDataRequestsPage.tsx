import { Ionicons } from '@expo/vector-icons';
import { Link, type Href, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Skeleton, TextField } from '@/components/ui';
import {
  useCancelPrivacyRequest,
  useCreatePrivacyRequest,
  useMyPrivacyRequests,
  usePrivacyRequest,
} from '@/features/privacy/hooks/use-privacy';
import {
  PRIVACY_REQUEST_TYPES,
  PRIVACY_STATUS_LABELS,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from '@/features/privacy/types';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';

import { useWebMeta } from '../use-web-meta';
import { WebFooter } from './WebFooter';
import { WebHeader } from './WebHeader';

const STATUS_TONE: Record<PrivacyRequestStatus, 'primary' | 'success' | 'warning' | 'danger' | 'muted'> = {
  received: 'primary',
  verification_pending: 'warning',
  in_review: 'primary',
  awaiting_user: 'warning',
  completed: 'success',
  rejected: 'danger',
  cancelled: 'muted',
};

/**
 * KVKK / kişisel veri talep merkezi. Başvurular yalnızca oturum açmış
 * kullanıcılar tarafından oluşturulur; böylece talep doğrudan hesaba bağlanır
 * ve başkasının adına başvuru yapılamaz.
 */
export function WebDataRequestsPage() {
  const { theme } = useTheme();
  const authStatus = useAuthStatus();

  useWebMeta({
    title: 'Trabzone Veri Talepleri ve KVKK Başvuruları',
    description:
      'Kişisel verilerinize erişim, kopya, düzeltme, silme ve itiraz taleplerinizi oluşturun ve takip edin.',
    path: '/data-requests',
    noIndex: true,
  });

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <WebHeader />
      <View style={styles.hero}>
        <View style={styles.heroInner}>
          <AppText variant="caption" color="#8EA6D8" style={styles.eyebrow}>
            KVKK VE VERİ KORUMA
          </AppText>
          <AppText
            variant="h1"
            color="#FFFFFF"
            style={styles.heroTitle}
            accessibilityRole="header"
          >
            Veri Talepleri Merkezi
          </AppText>
          <AppText variant="body" color="#A9BDE2" style={styles.heroSummary}>
            Verilerinize erişmek, kopyasını almak, düzeltmek veya silinmesini istemek için başvuru
            oluşturun. Her başvuru takip numarasıyla kayıt altına alınır.
          </AppText>
          <View style={styles.heroLinks}>
            <Link href={'/kvkk' as Href} asChild>
              <Pressable>
                <AppText variant="caption" color="#A8BEE8">
                  KVKK Aydınlatma Metni →
                </AppText>
              </Pressable>
            </Link>
            <Link href={'/privacy' as Href} asChild>
              <Pressable>
                <AppText variant="caption" color="#A8BEE8">
                  Gizlilik Politikası →
                </AppText>
              </Pressable>
            </Link>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        {authStatus === 'booting' ? (
          <View style={styles.skeleton}>
            <Skeleton height={20} width="45%" radius={6} />
            <Skeleton height={14} width="80%" radius={4} />
            <Skeleton height={120} radius={12} />
          </View>
        ) : authStatus === 'authenticated' ? (
          <AuthenticatedDataRequests />
        ) : (
          <Card style={styles.authCard}>
            <View style={[styles.authIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="shield-checkmark-outline" size={26} color={theme.colors.primaryDeep} />
            </View>
            <AppText variant="h2">Başvuru için giriş yapın</AppText>
            <AppText variant="body" color="textSecondary">
              Talebinizin doğru hesaba bağlanabilmesi ve kimlik doğrulamasının güvenli yapılabilmesi
              için giriş yapmanız gerekir. Hesabınıza erişemiyorsanız destek ekibimizle iletişime
              geçin.
            </AppText>
            <View style={styles.authActions}>
              <Link href={'/login' as Href} asChild>
                <Button label="Giriş Yap" style={styles.authButton} />
              </Link>
              <Link href={'/register' as Href} asChild>
                <Button label="Hesap Oluştur" variant="secondary" style={styles.authButton} />
              </Link>
            </View>
            <Link href={'/contact' as Href} asChild>
              <Pressable>
                <AppText variant="caption" color="primary">
                  Hesabıma erişemiyorum, iletişime geçmek istiyorum →
                </AppText>
              </Pressable>
            </Link>
          </Card>
        )}
      </View>
      <WebFooter />
    </View>
  );
}

function AuthenticatedDataRequests() {
  const { theme } = useTheme();
  const router = useRouter();
  const { data: requests, isLoading } = useMyPrivacyRequests();
  const createRequest = useCreatePrivacyRequest();
  const [type, setType] = useState<PrivacyRequestType>('access');
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [createdNo, setCreatedNo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const selected = useMemo(
    () => PRIVACY_REQUEST_TYPES.find((item) => item.code === type),
    [type],
  );
  const canSubmit = subject.trim().length >= 3 && details.trim().length >= 10;

  const submit = () => {
    setError(null);
    setCreatedNo(null);
    createRequest.mutate(
      { requestType: type, subject: subject.trim(), details: details.trim() },
      {
        onSuccess: (data) => {
          setCreatedNo(data.request_no);
          setSubject('');
          setDetails('');
        },
        onError: (mutationError) => setError(mutationError.message),
      },
    );
  };

  return (
    <View style={styles.twoColumn}>
      <View style={styles.formColumn}>
        <Card style={styles.formCard}>
          <View style={styles.sectionHead}>
            <View style={[styles.sectionIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="create-outline" size={20} color={theme.colors.primaryDeep} />
            </View>
            <View style={styles.flex}>
              <AppText variant="h3">Yeni başvuru oluştur</AppText>
              <AppText variant="caption" color="textSecondary">
                Talebiniz yetkili veri koruma personeli tarafından incelenir.
              </AppText>
            </View>
          </View>

          <AppText variant="caption" color="textSecondary" style={styles.fieldLabel}>
            Talep türü
          </AppText>
          <View style={styles.typeGrid}>
            {PRIVACY_REQUEST_TYPES.map((item) => {
              const active = item.code === type;
              return (
                <Pressable
                  key={item.code}
                  onPress={() => setType(item.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.typeOption,
                    {
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                    },
                  ]}
                >
                  <AppText
                    variant={active ? 'bodyStrong' : 'caption'}
                    color={active ? 'primaryDeep' : 'textSecondary'}
                  >
                    {item.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          {selected ? (
            <AppText variant="caption" color="textTertiary">
              {selected.hint}
            </AppText>
          ) : null}

          <View>
            <AppText variant="caption" color="textSecondary" style={styles.fieldLabel}>
              Konu
            </AppText>
            <TextField
              value={subject}
              onChangeText={setSubject}
              placeholder="Başvurunun kısa konusu"
              maxLength={160}
            />
          </View>
          <View>
            <AppText variant="caption" color="textSecondary" style={styles.fieldLabel}>
              Açıklama
            </AppText>
            <TextField
              value={details}
              onChangeText={setDetails}
              placeholder="Hangi verilerinizle ilgili talepte bulunduğunuzu ayrıntılı yazın."
              multiline
              numberOfLines={6}
              maxLength={5000}
              hint={`${details.trim().length}/5000 · En az 10 karakter`}
            />
          </View>

          {createdNo ? (
            <View style={[styles.successBox, { backgroundColor: theme.colors.successSoft }]}>
              <Ionicons name="checkmark-circle-outline" size={18} color={theme.colors.success} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Başvurunuz alındı. Takip numaranız: <AppText variant="bodyStrong">{createdNo}</AppText>
              </AppText>
            </View>
          ) : null}
          {error ? (
            <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.flex}>
                {error}
              </AppText>
            </View>
          ) : null}

          <Button
            label={createRequest.isPending ? 'Başvuru gönderiliyor…' : 'Başvuruyu gönder'}
            loading={createRequest.isPending}
            disabled={!canSubmit}
            onPress={submit}
          />
          <AppText variant="caption" color="textTertiary">
            Başvurularınız KVKK kapsamında en kısa sürede yanıtlanır. Ek bilgi gerekirse sizinle
            iletişime geçilir.
          </AppText>
        </Card>
      </View>

      <View style={styles.listColumn}>
        <View style={styles.listHead}>
          <AppText variant="h3">Başvurularım</AppText>
          {requests && requests.length > 0 ? (
            <View style={[styles.countBadge, { backgroundColor: theme.colors.primarySoft }]}>
              <AppText variant="caption" color="primaryDeep">
                {requests.length}
              </AppText>
            </View>
          ) : null}
        </View>

        {isLoading ? (
          <View style={styles.skeleton}>
            <Skeleton height={92} radius={12} />
            <Skeleton height={92} radius={12} />
          </View>
        ) : null}

        {!isLoading && (!requests || requests.length === 0) ? (
          <Card tone="muted" elevated={false} style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={26} color={theme.colors.textTertiary} />
            <AppText variant="bodyStrong">Henüz başvurunuz yok</AppText>
            <AppText variant="caption" color="textSecondary" align="center">
              Yeni bir başvuru oluşturduğunuzda burada listelenir ve durumunu takip edebilirsiniz.
            </AppText>
          </Card>
        ) : null}

        {requests?.map((request) => {
          const open = expanded === request.id;
          return (
            <RequestRow
              key={request.id}
              id={request.id}
              requestNo={request.request_no}
              title={request.subject}
              status={request.status}
              createdAt={request.created_at}
              dueAt={request.due_at}
              open={open}
              onToggle={() => setExpanded(open ? null : request.id)}
            />
          );
        })}

        <Card tone="muted" elevated={false} style={styles.helpCard}>
          <AppText variant="bodyStrong">Hesabınızı tamamen silmek mi istiyorsunuz?</AppText>
          <AppText variant="caption" color="textSecondary">
            Veri talebi hesabınızı silmez. Kalıcı silme için hesap silme sayfasını kullanın.
          </AppText>
          <Button
            label="Hesap Silme"
            variant="secondary"
            size="sm"
            onPress={() => router.push('/delete-account')}
          />
        </Card>
      </View>
    </View>
  );
}

function RequestRow({
  id,
  requestNo,
  title,
  status,
  createdAt,
  dueAt,
  open,
  onToggle,
}: {
  id: string;
  requestNo: string;
  title: string;
  status: PrivacyRequestStatus;
  createdAt: string;
  dueAt: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const { theme } = useTheme();
  const { data: detail } = usePrivacyRequest(open ? id : null);
  const cancel = useCancelPrivacyRequest();
  const tone = STATUS_TONE[status];
  const toneColor =
    tone === 'success'
      ? theme.colors.success
      : tone === 'warning'
        ? theme.colors.warning
        : tone === 'danger'
          ? theme.colors.danger
          : tone === 'primary'
            ? theme.colors.primaryDeep
            : theme.colors.textTertiary;
  const active = !['completed', 'rejected', 'cancelled'].includes(status);

  return (
    <View style={[styles.requestCard, { borderColor: theme.colors.border }]}>
      <Pressable onPress={onToggle} style={styles.requestHead}>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">{title}</AppText>
          <AppText variant="caption" color="textTertiary">
            {requestNo} · {formatDateTr(createdAt)}
          </AppText>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: `${toneColor}18` }]}>
          <AppText variant="caption" color={toneColor}>
            {PRIVACY_STATUS_LABELS[status]}
          </AppText>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={theme.colors.textTertiary}
        />
      </Pressable>

      {open ? (
        <View style={[styles.requestBody, { borderTopColor: theme.colors.border }]}>
          {detail ? (
            <>
              <AppText variant="caption" color="textSecondary">
                {detail.details}
              </AppText>
              {dueAt ? (
                <AppText variant="caption" color="textTertiary">
                  Hedef yanıt tarihi: {formatDateTr(dueAt)}
                </AppText>
              ) : null}
              {detail.response_summary ? (
                <View style={[styles.responseBox, { backgroundColor: theme.colors.surfaceMuted }]}>
                  <AppText variant="caption" color="textTertiary">
                    Yanıt
                  </AppText>
                  <AppText variant="body" color="textSecondary">
                    {detail.response_summary}
                  </AppText>
                </View>
              ) : null}
              {detail.history.length > 0 ? (
                <View style={styles.history}>
                  {detail.history.map((item, index) => (
                    <View key={`${item.status}-${index}`} style={styles.historyRow}>
                      <View style={[styles.historyDot, { backgroundColor: theme.colors.primary }]} />
                      <View style={styles.flex}>
                        <AppText variant="caption" color="textSecondary">
                          {PRIVACY_STATUS_LABELS[item.status] ?? item.status} ·{' '}
                          {formatDateTr(item.created_at)}
                        </AppText>
                        {item.note ? (
                          <AppText variant="caption" color="textTertiary">
                            {item.note}
                          </AppText>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
              {active ? (
                <Button
                  label="Başvuruyu iptal et"
                  variant="outline"
                  size="sm"
                  loading={cancel.isPending}
                  onPress={() => cancel.mutate(id)}
                />
              ) : null}
            </>
          ) : (
            <Skeleton height={40} radius={8} />
          )}
        </View>
      ) : null}
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
  heroLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 18 },
  body: {
    width: '100%',
    maxWidth: 1160,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 50,
  },
  twoColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' },
  formColumn: { flex: 1, minWidth: 300, maxWidth: 660 },
  listColumn: { flex: 1, minWidth: 300, maxWidth: 460, gap: 12 },
  formCard: { gap: 14, padding: 22 },
  sectionHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  sectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldLabel: { marginBottom: 6, marginTop: 4 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeOption: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  successBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 10 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 10 },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  emptyCard: { alignItems: 'center', gap: 8, padding: 28 },
  requestCard: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  requestHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  statusBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  requestBody: { borderTopWidth: 1, padding: 16, gap: 10 },
  responseBox: { gap: 4, padding: 12, borderRadius: 10 },
  history: { gap: 10 },
  historyRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  historyDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  helpCard: { gap: 8, padding: 18 },
  authCard: { gap: 12, padding: 28, maxWidth: 620, alignItems: 'flex-start' },
  authIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  authButton: { minWidth: 150 },
  skeleton: { gap: 10 },
});
