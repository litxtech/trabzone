import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  Screen,
  ScreenHeader,
  Skeleton,
  TextField,
} from '@/components/ui';
import { AuthGate } from '@/features/auth/components/AuthGate';
import {
  useCancelPrivacyRequest,
  useCreatePrivacyRequest,
  useMyPrivacyRequests,
} from '@/features/privacy/hooks/use-privacy';
import {
  PRIVACY_REQUEST_TYPES,
  PRIVACY_STATUS_LABELS,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from '@/features/privacy/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';

/**
 * Mobil KVKK / veri talebi merkezi. Web ile aynı Supabase RPC'lerini kullanır;
 * böylece talep kayıtları tek yerde tutulur.
 */
export default function DataRequestsScreen() {
  return (
    <AuthGate>
      <DataRequestsContent />
    </AuthGate>
  );
}

function DataRequestsContent() {
  const { theme } = useTheme();
  const router = useRouter();
  const createRequest = useCreatePrivacyRequest();
  const cancelRequest = useCancelPrivacyRequest();
  const { data: requests, isLoading } = useMyPrivacyRequests();

  const [type, setType] = useState<PrivacyRequestType>('access');
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [createdNo, setCreatedNo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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
    <Screen edges={['top', 'left', 'right']} scroll padded>
      <ScreenHeader
        title="Veri Talepleri"
        subtitle="KVKK ve kişisel veri başvuruları"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
      />

      <View style={[styles.intro, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name="shield-checkmark-outline" size={22} color={theme.colors.primaryDeep} />
        <AppText variant="caption" color="textSecondary" style={styles.flex}>
          Verilerinize erişim, kopya, düzeltme, silme veya itiraz talebinizi buradan oluşturabilirsiniz.
          Başvurular takip numarasıyla kayıt altına alınır.
        </AppText>
      </View>

      <Card style={styles.card}>
        <AppText variant="h3">Yeni başvuru</AppText>
        <AppText variant="caption" color="textTertiary">
          Talep türü
        </AppText>
        <View style={styles.typeGrid}>
          {PRIVACY_REQUEST_TYPES.map((item) => {
            const active = item.code === type;
            return (
              <Pressable
                key={item.code}
                onPress={() => setType(item.code)}
                style={[
                  styles.typeOption,
                  {
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={active ? 'primaryDeep' : 'textSecondary'}
                >
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <TextField
          label="Konu"
          value={subject}
          onChangeText={setSubject}
          placeholder="Başvurunun kısa konusu"
          maxLength={160}
        />
        <TextField
          label="Açıklama"
          value={details}
          onChangeText={setDetails}
          placeholder="Talebinizi ayrıntılı açıklayın."
          multiline
          numberOfLines={5}
          maxLength={5000}
          hint={`${details.trim().length}/5000 · En az 10 karakter`}
        />

        {createdNo ? (
          <View style={[styles.successBox, { backgroundColor: theme.colors.successSoft }]}>
            <Ionicons name="checkmark-circle-outline" size={17} color={theme.colors.success} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              Başvurunuz alındı. Takip numaranız: <AppText variant="bodyStrong">{createdNo}</AppText>
            </AppText>
          </View>
        ) : null}
        {error ? (
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        ) : null}

        <Button
          label={createRequest.isPending ? 'Gönderiliyor…' : 'Başvuruyu gönder'}
          loading={createRequest.isPending}
          disabled={!canSubmit}
          onPress={submit}
        />
      </Card>

      <View style={styles.listHead}>
        <AppText variant="h3">Başvurularım</AppText>
      </View>

      {isLoading ? (
        <View style={styles.skeleton}>
          <Skeleton height={80} radius={12} />
          <Skeleton height={80} radius={12} />
        </View>
      ) : null}

      {!isLoading && (!requests || requests.length === 0) ? (
        <Card tone="muted" elevated={false} style={styles.empty}>
          <Ionicons name="document-text-outline" size={24} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textSecondary" align="center">
            Henüz bir başvurunuz yok. Oluşturduğunuz başvurular burada listelenir.
          </AppText>
        </Card>
      ) : null}

      {requests?.map((request) => {
        const open = expanded === request.id;
        const active = !['completed', 'rejected', 'cancelled'].includes(request.status);
        return (
          <Card key={request.id} style={styles.requestCard}>
            <Pressable onPress={() => setExpanded(open ? null : request.id)} style={styles.requestHead}>
              <View style={styles.flex}>
                <AppText variant="bodyStrong">{request.subject}</AppText>
                <AppText variant="caption" color="textTertiary">
                  {request.request_no} · {formatDateTr(request.created_at)}
                </AppText>
              </View>
              <StatusBadge status={request.status} />
              <Ionicons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={theme.colors.textTertiary}
              />
            </Pressable>
            {open ? (
              <View style={[styles.requestBody, { borderTopColor: theme.colors.border }]}>
                <AppText variant="caption" color="textSecondary">
                  {request.response_summary ?? 'Başvurunuz inceleniyor. Yanıt geldiğinde burada görünecek.'}
                </AppText>
                {request.due_at ? (
                  <AppText variant="caption" color="textTertiary">
                    Hedef yanıt tarihi: {formatDateTr(request.due_at)}
                  </AppText>
                ) : null}
                {active ? (
                  <Button
                    label="Başvuruyu iptal et"
                    variant="outline"
                    size="sm"
                    loading={cancelRequest.isPending}
                    onPress={() => cancelRequest.mutate(request.id)}
                  />
                ) : null}
              </View>
            ) : null}
          </Card>
        );
      })}

      <Card tone="muted" elevated={false} style={styles.card}>
        <AppText variant="bodyStrong">Hesabınızı tamamen silmek mi istiyorsunuz?</AppText>
        <AppText variant="caption" color="textSecondary">
          Veri talebi hesabınızı silmez. Kalıcı silme için hesap silme ekranını kullanın.
        </AppText>
        <Button
          label="Hesabımı Sil"
          variant="secondary"
          size="sm"
          onPress={() => router.push('/settings/delete-account')}
        />
      </Card>
    </Screen>
  );
}

function StatusBadge({ status }: { status: PrivacyRequestStatus }) {
  const { theme } = useTheme();
  const color =
    status === 'completed'
      ? theme.colors.success
      : status === 'rejected'
        ? theme.colors.danger
        : status === 'cancelled'
          ? theme.colors.textTertiary
          : theme.colors.primaryDeep;
  return (
    <View style={[styles.badge, { backgroundColor: `${color}18` }]}>
      <AppText variant="caption" color={color}>
        {PRIVACY_STATUS_LABELS[status]}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 14, alignItems: 'flex-start' },
  card: { gap: 12, padding: 18, marginTop: 14 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeOption: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  successBox: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10, alignItems: 'flex-start' },
  listHead: { marginTop: 22, marginBottom: 8 },
  skeleton: { gap: 10 },
  empty: { alignItems: 'center', gap: 8, padding: 24 },
  requestCard: { gap: 0, padding: 0, marginBottom: 10, overflow: 'hidden' },
  requestHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  requestBody: { borderTopWidth: 1, padding: 14, gap: 10 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
});
