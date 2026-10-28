import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card, IconButton, Screen } from '@/components/ui';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useTheme } from '@/theme/ThemeProvider';

import {
  IdentityReadyBanner,
  VERIFIED_BLUE,
  VerifiedTick,
} from '@/features/ride/components/IdentityBadge';
import { useRideProfile } from '@/features/ride/hooks/use-ride';
import type { VerificationKind } from '@/features/ride/types';
import { VERIFICATION_LABEL, formatDate } from '@/features/ride/utils/format';
import {
  VERIFICATION_PURPOSE,
  VERIFICATION_REQUIREMENT,
  effectiveIdentityStatus,
  effectiveVerificationStatus,
  fullName,
  identityExpiresAt,
  identityVerifiedAt,
  isoToTrDate,
  latestVerification,
  maskDocumentNo,
  metaText,
} from '@/features/ride/utils/identity';

const KINDS: VerificationKind[] = [
  'identity',
  'driver_license',
  'insurance',
  'transport_license',
];

const KIND_ICON: Record<
  VerificationKind,
  React.ComponentProps<typeof Ionicons>['name']
> = {
  identity: 'id-card-outline',
  driver_license: 'car-outline',
  insurance: 'shield-checkmark-outline',
  transport_license: 'briefcase-outline',
};

const STATUS_LABEL: Record<string, string> = {
  approved: 'Doğrulandı',
  pending: 'İnceleniyor',
  rejected: 'Reddedildi',
  expired: 'Süresi doldu',
  unverified: 'Doğrulanmadı',
};

const TONE = (status: string): 'success' | 'warning' | 'danger' | 'neutral' =>
  status === 'approved'
    ? 'success'
    : status === 'pending'
      ? 'warning'
      : status === 'rejected' || status === 'expired'
        ? 'danger'
        : 'neutral';

const DRIVER_STATUS_LABEL: Record<string, string> = {
  approved: 'Sürücü yetkin açık',
  pending: 'Sürücü başvurun inceleniyor',
  rejected: 'Sürücü başvurun reddedildi',
  suspended: 'Sürücü yetkin askıda',
  none: 'Henüz sürücü başvurusu yok',
};

export default function SettingsVerificationsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const rideProfile = useRideProfile();
  const myProfile = useMyProfile();

  const data = rideProfile.data;
  const identityStatus = effectiveIdentityStatus(data);
  const identityApproved = identityStatus === 'approved';
  const identityRecord = latestVerification(data, 'identity');
  const verifiedAt = identityVerifiedAt(data);
  const expiresAt = identityExpiresAt(data);
  const displayName =
    metaText(identityRecord?.meta, 'full_name') ||
    (myProfile.data ? fullName(myProfile.data.first_name, myProfile.data.last_name) : '');
  const documentNo = maskDocumentNo(metaText(identityRecord?.meta, 'document_no'));
  const birthDate = isoToTrDate(metaText(identityRecord?.meta, 'birth_date'));
  const driverStatus = data?.driver_status ?? 'none';

  const rows = KINDS.map((kind) => {
    const record = latestVerification(data, kind);
    const status =
      kind === 'identity'
        ? identityStatus
        : record
          ? effectiveVerificationStatus(record)
          : 'unverified';
    const rowVerifiedAt =
      kind === 'identity' ? verifiedAt : (record?.reviewed_at ?? record?.created_at ?? null);
    const rowExpiry = kind === 'identity' ? expiresAt : (record?.expires_at ?? null);
    return { kind, record, status, rowVerifiedAt, rowExpiry };
  });
  const approvedCount = rows.filter((row) => row.status === 'approved').length;

  if (rideProfile.isLoading) {
    return (
      <Screen edges={['top', 'left', 'right']} padded>
        <View style={styles.header}>
          <IconButton
            name="chevron-back"
            accessibilityLabel="Geri"
            variant="surface"
            size={20}
            onPress={() => router.back()}
          />
          <AppText variant="h3">Doğrulamalar</AppText>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Geri"
          variant="surface"
          size={20}
          onPress={() => router.back()}
        />
        <AppText variant="h3">Doğrulamalar</AppText>
        <View style={styles.headerSpacer} />
      </View>

      {identityApproved ? (
        <IdentityReadyBanner
          subtitle="Kimliğin onaylı. Yolculuk ekranlarında mavi tik görünür ve tekrar belge istenmez."
        />
      ) : identityStatus === 'pending' ? (
        <Card padding={14} tone="muted" style={styles.intro}>
          <View style={[styles.introIcon, { backgroundColor: theme.colors.warningSoft }]}>
            <Ionicons name="time-outline" size={20} color={theme.colors.warning} />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Kimlik doğrulaman inceleniyor</AppText>
            <AppText variant="caption" color="textSecondary">
              Belgen doğrulama ekibi tarafından kontrol ediliyor. Onaylandığında mavi tik
              görünür ve tekrar belge istenmez.
            </AppText>
          </View>
        </Card>
      ) : (
        <Card padding={14} tone="primarySoft" style={styles.intro}>
          <View style={[styles.introIcon, { backgroundColor: theme.colors.primary }]}>
            <Ionicons name="shield-checkmark-outline" size={20} color="#FFFFFF" />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">
              {identityStatus === 'rejected' ? 'Kimlik doğrulaman reddedildi' : 'Kimlik doğrulaması gerekli'}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              Yolculuk rezervasyonu ve ilan yayınlama için kimliğini bir kez doğrulaman yeterli.
            </AppText>
          </View>
          <Button
            label={identityStatus === 'rejected' ? 'Yeniden dene' : 'Doğrula'}
            size="sm"
            fullWidth={false}
            onPress={() => router.navigate('/ride/verification' as never)}
          />
        </Card>
      )}

      <Card padding={15} style={styles.summary}>
        <View style={styles.summaryHead}>
          <View style={styles.flex}>
            <AppText variant="title">Doğrulanan kimlikler</AppText>
            <AppText variant="caption" color="textTertiary">
              Hangi belge onaylı ve ne için kullanılıyor?
            </AppText>
          </View>
          <Badge label={`${approvedCount}/${KINDS.length} onaylı`} tone="primary" />
        </View>

        {rows.map((row, index) => {
          const approved = row.status === 'approved';
          const record = row.record;
          return (
            <Pressable
              key={row.kind}
              accessibilityRole="button"
              accessibilityLabel={`${VERIFICATION_LABEL[row.kind]} detayı`}
              onPress={() => router.navigate('/ride/verification' as never)}
              style={({ pressed }) => [
                styles.row,
                {
                  borderTopColor: theme.colors.divider,
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.rowIcon,
                  {
                    backgroundColor: approved
                      ? 'rgba(29,155,240,0.12)'
                      : theme.colors.surfaceMuted,
                  },
                ]}
              >
                {approved ? (
                  <VerifiedTick size={21} />
                ) : (
                  <Ionicons
                    name={KIND_ICON[row.kind]}
                    size={19}
                    color={theme.colors.textTertiary}
                  />
                )}
              </View>
              <View style={styles.flex}>
                <View style={styles.rowTitle}>
                  <AppText variant="bodyStrong">{VERIFICATION_LABEL[row.kind]}</AppText>
                  {approved ? <VerifiedTick size={13} /> : null}
                  <Badge label={STATUS_LABEL[row.status] ?? row.status} tone={TONE(row.status)} />
                </View>
                <AppText variant="caption" color="textSecondary">
                  Ne için: {VERIFICATION_PURPOSE[row.kind]}
                </AppText>
                {approved ? (
                  <AppText variant="caption" color="textTertiary">
                    {row.rowVerifiedAt ? `${formatDate(row.rowVerifiedAt)} tarihinde onaylandı` : 'Onaylandı'}
                    {' · '}
                    {row.rowExpiry ? `Geçerlilik ${formatDate(row.rowExpiry)}` : 'Süresiz'}
                  </AppText>
                ) : row.status === 'rejected' ? (
                  <AppText variant="caption" color="danger" numberOfLines={2}>
                    {record?.reject_reason ?? 'Belge reddedildi. Yeniden yükleyebilirsin.'}
                  </AppText>
                ) : row.status === 'pending' ? (
                  <AppText variant="caption" color="textTertiary">
                    Belgen inceleniyor; tekrar yükleme gerekmez.
                  </AppText>
                ) : (
                  <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                    {VERIFICATION_REQUIREMENT[row.kind]}
                  </AppText>
                )}
              </View>
              <Ionicons
                name="chevron-forward"
                size={15}
                color={theme.colors.textTertiary}
              />
            </Pressable>
          );
        })}
      </Card>

      {identityApproved ? (
        <Card padding={15} style={styles.detailCard}>
          <View style={styles.detailHead}>
            <VerifiedTick size={20} />
            <AppText variant="title">Doğrulanan kimlik bilgileri</AppText>
          </View>
          <View style={styles.detailGrid}>
            <Detail label="Ad soyad" value={displayName || '—'} />
            <Detail label="T.C. Kimlik No" value={documentNo ?? '—'} />
            <Detail label="Doğum tarihi" value={birthDate || '—'} />
            <Detail label="Onay tarihi" value={verifiedAt ? formatDate(verifiedAt) : '—'} />
            <Detail label="Geçerlilik" value={expiresAt ? formatDate(expiresAt) : 'Süresiz'} />
            <Detail label="Kullanım" value={VERIFICATION_PURPOSE.identity} />
          </View>
          <AppText variant="caption" color="textTertiary">
            Bu bilgiler yalnızca sana gösterilir. Kimlik numarası maskelenir; arama ve eşleştirme
            sonuçlarında paylaşılmaz.
          </AppText>
        </Card>
      ) : null}

      <Card padding={15} style={styles.detailCard}>
        <View style={styles.detailHead}>
          <Ionicons
            name={driverStatus === 'approved' ? 'checkmark-circle' : 'car-outline'}
            size={20}
            color={driverStatus === 'approved' ? VERIFIED_BLUE : theme.colors.primaryDeep}
          />
          <AppText variant="title">Sürücü yetkisi</AppText>
          <Badge
            label={DRIVER_STATUS_LABEL[driverStatus] ?? driverStatus}
            tone={driverStatus === 'approved' ? 'success' : driverStatus === 'pending' ? 'warning' : 'neutral'}
          />
        </View>
        <AppText variant="caption" color="textSecondary">
          {driverStatus === 'approved'
            ? 'İlan yayınlayabilir ve rezervasyonları yönetebilirsin. Araç onayı için garajındaki ruhsat ve sigorta belgeleri de onaylı olmalı.'
            : 'Sürücü olarak ilan yayınlamak için kimlik ve sürücü belgesi onayı gerekir. Başvuruyu doğrulama merkezinden yapabilirsin.'}
        </AppText>
        <Button
          label={
            driverStatus === 'approved'
              ? 'Yolculuk paylaş'
              : driverStatus === 'pending'
                ? 'Başvuru durumunu gör'
                : 'Sürücü başvurusu yap'
          }
          variant="secondary"
          size="sm"
          fullWidth={false}
          onPress={() =>
            router.navigate(
              (driverStatus === 'approved' ? '/ride/create' : '/ride/verification') as never,
            )
          }
        />
      </Card>

      <Card padding={15} tone="muted" style={styles.detailCard}>
        <View style={styles.detailHead}>
          <Ionicons name="lock-closed-outline" size={16} color={theme.colors.primaryDeep} />
          <AppText variant="title">Belgelerin güvenliği</AppText>
        </View>
        <AppText variant="caption" color="textSecondary">
          Belgeler gizli `ride-documents` kovasında saklanır ve yalnızca yetkili doğrulama
          inceleyicileri tarafından görülebilir. Onaylı bir belge için sistem tekrar doğrulama
          istemez; yalnızca belgenin geçerlilik süresi dolduğunda yenileme istenir.
        </AppText>
        <Button
          label="Doğrulama merkezine git"
          size="sm"
          fullWidth={false}
          onPress={() => router.navigate('/ride/verification' as never)}
        />
      </Card>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <AppText variant="bodyStrong" numberOfLines={2}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 16,
  },
  headerSpacer: { width: 44 },
  center: { paddingVertical: 60, alignItems: 'center' },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  introIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: { gap: 2, marginTop: 12 },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
    marginBottom: 1,
  },
  detailCard: { gap: 9, marginTop: 12 },
  detailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexWrap: 'wrap',
  },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  detail: { flexBasis: '46%', flexGrow: 1, gap: 1 },
});
