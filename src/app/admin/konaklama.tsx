import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { useTheme } from '@/theme/ThemeProvider';

import { ModalSheet } from '@/features/accommodation/components/AccommodationUI';
import {
  useAdminProperties,
  useAdminPropertyClaims,
  useLiteApiAdminStatus,
  useLiteApiSync,
  useReviewAdminPropertyClaim,
  useReviewProperty,
} from '@/features/accommodation/hooks/use-accommodation';
import { accommodationDocumentUrl } from '@/features/accommodation/services/accommodation-media-service';
import type {
  AdminProperty,
  AdminPropertyClaim,
  LiteApiAdminStatus,
  LiteApiSyncResult,
} from '@/features/accommodation/types';
import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  VERIFICATION_STATUS_LABELS,
  formatDate,
} from '@/features/accommodation/utils/format';

type StatusFilter = 'pending' | 'published' | 'rejected' | 'all';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'Onay bekleyen' },
  { key: 'published', label: 'Yayında' },
  { key: 'rejected', label: 'Reddedilen' },
  { key: 'all', label: 'Tümü' },
];

export default function AdminAccommodationScreen() {
  const { theme } = useTheme();
  const me = useAdminMe();
  const [status, setStatus] = useState<StatusFilter>('pending');
  const properties = useAdminProperties(status);
  const [selected, setSelected] = useState<AdminProperty | null>(null);

  const items = properties.data?.items ?? [];
  const counts = properties.data?.counts;

  if (!me.isLoading && me.data && !me.data.is_admin) {
    return (
      <AdminPage title="Konaklama doğrulama" subtitle="Bu ekran yalnızca yöneticilere açıktır.">
        <AdminSection title="Yetki gerekli">
          <AppText variant="body" color="textSecondary">
            Tesis doğrulama işlemleri için yönetici yetkisi gerekir.
          </AppText>
        </AdminSection>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title="Konaklama doğrulama"
      subtitle="Tesis başvurularını, işletme belgelerini ve yayın durumunu incele. Doğrulanmamış tesis kamuya açık rezervasyon satışına açılmaz."
      refreshing={properties.isRefetching}
      onRefresh={() => void properties.refetch()}
      actions={
        <Badge
          label={counts ? `${counts.pending} onay bekliyor` : 'Yükleniyor…'}
          tone={counts && counts.pending > 0 ? 'warning' : 'neutral'}
        />
      }
    >
      <View style={styles.stats}>
        <StatCard label="Onay bekleyen" value={counts?.pending ?? 0} tone={theme.colors.warning} icon="hourglass-outline" />
        <StatCard label="Yayında" value={counts?.published ?? 0} tone={theme.colors.success} icon="checkmark-circle-outline" />
        <StatCard label="Reddedilen" value={counts?.rejected ?? 0} tone={theme.colors.danger} icon="close-circle-outline" />
        <StatCard label="Askıda" value={counts?.suspended ?? 0} tone={theme.colors.textTertiary} icon="pause-circle-outline" />
      </View>

      <LiteApiAdminPanel enabled={Boolean(me.data?.is_admin)} />

      <FilterChips
        options={FILTERS.map((filter) => ({
          ...filter,
          count:
            filter.key === 'pending'
              ? counts?.pending
              : filter.key === 'published'
                ? counts?.published
                : filter.key === 'rejected'
                  ? counts?.rejected
                  : undefined,
        }))}
        value={status}
        onChange={setStatus}
      />

      {properties.isLoading ? (
        <AdminSection title="Başvurular yükleniyor">
          <AppText variant="caption" color="textTertiary">Tesis kayıtları getiriliyor…</AppText>
        </AdminSection>
      ) : properties.isError ? (
        <AdminSection title="Başvurular yüklenemedi">
          <AppText variant="caption" color="danger">
            {properties.error instanceof Error ? properties.error.message : 'Bilinmeyen hata'}
          </AppText>
          <Button label="Tekrar dene" size="sm" variant="outline" fullWidth={false} onPress={() => void properties.refetch()} />
        </AdminSection>
      ) : items.length === 0 ? (
        <AdminSection title="Kayıt yok" subtitle="Seçilen durumda tesis başvurusu bulunmuyor.">
          <AppText variant="caption" color="textTertiary">
            Yeni başvurular geldiğinde burada listelenir. Onay bekleyen sekmesini kontrol edebilirsin.
          </AppText>
        </AdminSection>
      ) : (
        <View style={styles.grid}>
          {items.map((property) => (
            <PropertyReviewCard
              key={property.id}
              property={property}
              onPress={() => setSelected(property)}
            />
          ))}
        </View>
      )}

      <ReviewModal key={selected?.id ?? 'none'} property={selected} onClose={() => setSelected(null)} />
    </AdminPage>
  );
}

function LiteApiAdminPanel({ enabled }: { enabled: boolean }) {
  const { theme } = useTheme();
  const statusQuery = useLiteApiAdminStatus(enabled);
  const claims = useAdminPropertyClaims('pending', enabled);
  const sync = useLiteApiSync();
  const reviewClaim = useReviewAdminPropertyClaim();
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    mode: 'test' | 'full';
    inserted: number;
    updated: number;
    linked: number;
    skipped: number;
    failed: number;
    scanned: number;
    batches: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimNote, setClaimNote] = useState('');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  if (!enabled) return null;

  const status: LiteApiAdminStatus | undefined = statusQuery.data;
  const provider =
    status?.provider && 'active' in status.provider && typeof status.provider.active === 'boolean'
      ? status.provider
      : null;
  const lastRun =
    status?.last_run && 'id' in status.last_run && typeof status.last_run.id === 'string'
      ? status.last_run
      : null;
  const pendingClaims = claims.data?.items ?? [];

  /**
   * Tam senkron tek istekte bitmez: sunucu sayfa sayfa ilerler ve
   * `hasMore` döner. Yönetici tetiklediğinde partiler sırayla yürütülür.
   */
  const runSync = async (mode: 'test' | 'full') => {
    setError(null);
    setSummary(null);
    setProgress(mode === 'test' ? '10 otel test taraması başlatılıyor…' : 'Trabzon taraması başlatılıyor…');
    let cursor = 0;
    let runId: string | null = null;
    let phase: 'city' | 'radius' = 'city';
    let batches = 0;
    const totals = { inserted: 0, updated: 0, linked: 0, skipped: 0, failed: 0, scanned: 0 };
    const maxBatches = mode === 'test' ? 1 : 80;
    try {
      while (batches < maxBatches) {
        const result: LiteApiSyncResult = await sync.mutateAsync({
          mode,
          cursor,
          phase,
          runId,
          limit: mode === 'test' ? 10 : 25,
        });
        batches += 1;
        totals.inserted += result.counts.inserted;
        totals.updated += result.counts.updated;
        totals.linked += result.counts.linked;
        totals.skipped += result.counts.skipped;
        totals.failed += result.counts.failed;
        totals.scanned += result.counts.scanned;
        setProgress(
          `${batches}. parti · ${result.phase} · taranan ${totals.scanned} · eklenen ${totals.inserted} · güncellenen ${totals.updated}`,
        );
        if (!result.hasMore) {
          runId = result.runId;
          break;
        }
        runId = result.runId;
        cursor = result.nextCursor;
        phase = result.nextPhase === 'radius' ? 'radius' : 'city';
      }
      setSummary({ mode, ...totals, batches });
      if (runId) setProgress(`Senkron tamamlandı · çalışma ${runId.slice(0, 8)}…`);
      void statusQuery.refetch();
      void claims.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Senkronizasyon başarısız.');
      setProgress(null);
    }
  };

  const decideClaim = async (claim: AdminPropertyClaim, approve: boolean) => {
    setClaimError(null);
    setReviewingId(claim.id);
    try {
      await reviewClaim.mutateAsync({
        claimId: claim.id,
        approve,
        note: claimNote.trim() || null,
      });
      setClaimNote('');
      void claims.refetch();
    } catch (cause) {
      setClaimError(cause instanceof Error ? cause.message : 'Sahiplenme talebi işlenemedi.');
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <>
      <AdminSection
        title="LiteAPI otel senkronizasyonu"
        subtitle="Yalnızca Trabzon il sınırı doğrulanan tesisler aktarılır. Manuel tesisler korunur; mükerrer kayıt oluşturulmaz."
        action={
          <Badge
            label={provider?.active ? 'Sağlayıcı açık' : 'Sağlayıcı kapalı'}
            tone={provider?.active ? 'success' : 'neutral'}
          />
        }
      >
        <View style={styles.stats}>
          <StatCard
            label="API tesisi"
            value={status?.stats.external_total ?? 0}
            tone={theme.colors.primary}
            icon="cloud-download-outline"
          />
          <StatCard
            label="Yayında"
            value={status?.stats.external_published ?? 0}
            tone={theme.colors.success}
            icon="checkmark-circle-outline"
          />
          <StatCard
            label="Sahiplenilen"
            value={status?.stats.claimed ?? 0}
            tone={theme.colors.accent}
            icon="shield-checkmark-outline"
          />
          <StatCard
            label="Bekleyen talep"
            value={status?.stats.pending_claims ?? 0}
            tone={theme.colors.warning}
            icon="hourglass-outline"
          />
        </View>

        <View style={styles.syncMetaGrid}>
          <View style={[styles.syncMetaCell, { borderColor: theme.colors.border }]}>
            <AppText variant="caption" color="textTertiary">Manuel tesis</AppText>
            <AppText variant="bodyStrong">{status?.stats.manual_total ?? '—'}</AppText>
          </View>
          <View style={[styles.syncMetaCell, { borderColor: theme.colors.border }]}>
            <AppText variant="caption" color="textTertiary">Booking anahtarı</AppText>
            <AppText variant="bodyStrong" color={provider?.booking_enabled ? 'success' : 'textSecondary'}>
              {provider?.booking_enabled ? 'Açık' : 'Kapalı'}
            </AppText>
          </View>
          <View style={[styles.syncMetaCell, { borderColor: theme.colors.border }]}>
            <AppText variant="caption" color="textTertiary">Tesiste ödeme</AppText>
            <AppText variant="bodyStrong" color={provider?.property_pay_enabled ? 'success' : 'textSecondary'}>
              {provider?.property_pay_enabled ? 'Destekli' : 'Kapalı'}
            </AppText>
          </View>
          <View style={[styles.syncMetaCell, { borderColor: theme.colors.border }]}>
            <AppText variant="caption" color="textTertiary">Komisyon</AppText>
            <AppText variant="bodyStrong">%{provider?.commission_rate ?? 0}</AppText>
          </View>
        </View>

        <View style={[styles.syncBanner, { backgroundColor: theme.colors.warningSoft }]}>
          <Ionicons name="lock-closed-outline" size={14} color={theme.colors.warning} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Canlı rezervasyon varsayılan olarak kapalıdır. Açmak için veritabanı anahtarına ek olarak sunucuda
            LITEAPI_BOOKING_ENABLED ve LITEAPI_BOOKING_OWNER_APPROVED bayrakları gerekir.
          </AppText>
        </View>

        <View style={styles.syncActions}>
          <Button
            label="10 otel test senkronu"
            size="sm"
            fullWidth={false}
            loading={sync.isPending && progress?.startsWith('10 otel') === true}
            disabled={sync.isPending}
            onPress={() => void runSync('test')}
          />
          <Button
            label="Trabzon tam senkron"
            size="sm"
            variant="outline"
            fullWidth={false}
            disabled={sync.isPending}
            onPress={() => void runSync('full')}
          />
        </View>

        {progress ? (
          <View style={[styles.syncProgress, { borderColor: theme.colors.border }]}>
            {sync.isPending ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              {progress}
            </AppText>
          </View>
        ) : null}

        {error ? (
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        ) : null}

        {summary ? (
          <View style={[styles.syncBanner, { backgroundColor: theme.colors.successSoft }]}>
            <Ionicons name="checkmark-circle-outline" size={14} color={theme.colors.success} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              {summary.mode === 'test' ? 'Test' : 'Tam senkron'} · {summary.batches} parti · taranan{' '}
              {summary.scanned} · eklenen {summary.inserted} · güncellenen {summary.updated} · bağlanan{' '}
              {summary.linked} · atlanan {summary.skipped} · hata {summary.failed}
            </AppText>
          </View>
        ) : null}

        {lastRun ? (
          <View style={[styles.syncRun, { borderTopColor: theme.colors.divider }]}>
            <View style={styles.rowBetween}>
              <AppText variant="caption" color="textSecondary">
                Son senkron · {lastRun.mode === 'full' ? 'tam' : 'test'}
              </AppText>
              <Badge
                label={SYNC_STATUS_LABELS[lastRun.status ?? 'running'] ?? 'Bilinmiyor'}
                tone={lastRun.status === 'success' ? 'success' : lastRun.status === 'failed' ? 'danger' : 'warning'}
              />
            </View>
            <AppText variant="caption" color="textTertiary">
              {lastRun.started_at ? formatDate(lastRun.started_at.slice(0, 10)) : '—'} · taranan{' '}
              {lastRun.scanned ?? 0} · eklenen {lastRun.inserted ?? 0} · güncellenen {lastRun.updated ?? 0} ·
              atlanan {lastRun.skipped ?? 0} · hata {lastRun.failed ?? 0}
              {lastRun.triggered_by_label ? ` · ${lastRun.triggered_by_label}` : ''}
            </AppText>
            {lastRun.error ? (
              <AppText variant="caption" color="danger">
                {lastRun.error}
              </AppText>
            ) : null}
          </View>
        ) : null}

        {status && status.recent_errors.length > 0 ? (
          <View style={[styles.syncRun, { borderTopColor: theme.colors.divider }]}>
            <AppText variant="caption" color="textSecondary">Son hatalar</AppText>
            {status.recent_errors.slice(0, 6).map((entry) => (
              <AppText key={entry.id} variant="caption" color="textTertiary" numberOfLines={2}>
                {entry.hotel_name ?? entry.external_id ?? 'Bilinmeyen tesis'} · {entry.code}
                {entry.message ? ` · ${entry.message}` : ''}
              </AppText>
            ))}
          </View>
        ) : null}
      </AdminSection>

      <AdminSection
        title="Sahiplenme talepleri"
        subtitle="API kaynaklı tesisin işletmeci tarafından sahiplenilmesi. Onaylanınca tesis PMS'e bağlanır."
        action={<Badge label={`${pendingClaims.length} bekliyor`} tone={pendingClaims.length > 0 ? 'warning' : 'neutral'} />}
      >
        {claims.isLoading ? (
          <AppText variant="caption" color="textTertiary">Talepler yükleniyor…</AppText>
        ) : claims.isError ? (
          <AppText variant="caption" color="danger">
            {claims.error instanceof Error ? claims.error.message : 'Talepler yüklenemedi.'}
          </AppText>
        ) : pendingClaims.length === 0 ? (
          <AppText variant="caption" color="textTertiary">
            Onay bekleyen sahiplenme talebi yok.
          </AppText>
        ) : (
          <>
            <TextField
              label="Karar notu (opsiyonel)"
              value={claimNote}
              onChangeText={setClaimNote}
              placeholder="Onay/ret gerekçesi"
            />
            {claimError ? (
              <AppText variant="caption" color="danger">
                {claimError}
              </AppText>
            ) : null}
            {pendingClaims.map((claim) => (
              <View key={claim.id} style={[styles.claimRow, { borderColor: theme.colors.border }]}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>{claim.property.name}</AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {claim.property.district ?? 'Trabzon'}
                    {claim.property.external_id ? ` · ${claim.property.external_id}` : ''} ·{' '}
                    {claim.user.display_name ?? claim.user.username ?? 'İşletmeci'}
                  </AppText>
                  {claim.note ? (
                    <AppText variant="caption" color="textSecondary" numberOfLines={2}>{claim.note}</AppText>
                  ) : null}
                  <AppText variant="caption" color="textTertiary">{formatDate(claim.created_at.slice(0, 10))}</AppText>
                </View>
                <View style={styles.claimActions}>
                  <Button
                    label="Onayla"
                    size="sm"
                    fullWidth={false}
                    loading={reviewingId === claim.id && reviewClaim.isPending}
                    disabled={reviewClaim.isPending}
                    onPress={() => void decideClaim(claim, true)}
                  />
                  <Button
                    label="Reddet"
                    size="sm"
                    variant="danger"
                    fullWidth={false}
                    disabled={reviewClaim.isPending}
                    onPress={() => void decideClaim(claim, false)}
                  />
                </View>
              </View>
            ))}
          </>
        )}
      </AdminSection>
    </>
  );
}

const SYNC_STATUS_LABELS: Record<string, string> = {
  running: 'Çalışıyor',
  success: 'Başarılı',
  partial: 'Kısmi',
  failed: 'Başarısız',
};

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name={icon} size={16} color={tone} />
      </View>
      <AppText variant="h2" style={{ color: tone }}>{value}</AppText>
      <AppText variant="caption" color="textTertiary" numberOfLines={1}>{label}</AppText>
    </View>
  );
}

function PropertyReviewCard({ property, onPress }: { property: AdminProperty; onPress: () => void }) {
  const { theme } = useTheme();
  const pendingDocs = property.documents.filter((document) => document.status === 'pending').length;
  const tone =
    property.verification_status === 'verified'
      ? theme.colors.success
      : property.verification_status === 'rejected'
        ? theme.colors.danger
        : theme.colors.warning;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${property.name} başvurusunu incele`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.88 : 1,
        },
      ]}
    >
      <View style={styles.cardHead}>
        <View style={[styles.cardIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="business-outline" size={18} color={theme.colors.primary} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong" numberOfLines={1}>{property.name}</AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {PROPERTY_TYPE_LABELS[property.property_type]}
            {property.district ? ` · ${property.district}` : ''}
          </AppText>
        </View>
        <View style={[styles.dot, { backgroundColor: tone }]} />
      </View>

      <View style={styles.metaRow}>
        <Badge label={PROPERTY_STATUS_LABELS[property.status]} tone="neutral" />
        {property.source === 'liteapi' ? <Badge label="LiteAPI" tone="primary" /> : null}
        <Badge
          label={VERIFICATION_STATUS_LABELS[property.verification_status]}
          tone={property.verification_status === 'verified' ? 'success' : 'warning'}
        />
        {pendingDocs > 0 ? <Badge label={`${pendingDocs} belge`} tone="warning" /> : null}
      </View>

      <View style={styles.metaRow}>
        <AppText variant="caption" color="textTertiary">
          {property.owner.display_name ?? property.owner.username}
        </AppText>
        <AppText variant="caption" color="textTertiary">·</AppText>
        <AppText variant="caption" color="textTertiary">{formatDate(property.created_at)}</AppText>
      </View>

      <View style={styles.metaRow}>
        <AppText variant="caption" color="textSecondary">
          {property.room_type_count} oda tipi · {property.room_count} fiziksel oda
        </AppText>
      </View>

      {property.missing.length > 0 ? (
        <AppText variant="caption" color="warning" numberOfLines={2}>
          Eksik: {property.missing.slice(0, 3).join(', ')}
          {property.missing.length > 3 ? ` +${property.missing.length - 3}` : ''}
        </AppText>
      ) : (
        <AppText variant="caption" color="success">Zorunlu bilgiler tamam</AppText>
      )}
    </Pressable>
  );
}

function ReviewModal({ property, onClose }: { property: AdminProperty | null; onClose: () => void }) {
  const { theme } = useTheme();
  const review = useReviewProperty();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);

  const close = () => {
    setNote('');
    setError(null);
    setConfirmReject(false);
    onClose();
  };

  if (!property) return null;

  const openDocument = async (path: string) => {
    setError(null);
    const url = await accommodationDocumentUrl(path);
    if (!url) {
      setError('Belge bağlantısı oluşturulamadı. Yetki veya depolama ayarını kontrol et.');
      return;
    }
    await Linking.openURL(url);
  };

  const decide = async (approve: boolean) => {
    setError(null);
    if (!approve && note.trim().length < 5) {
      setError('Reddetmek için en az 5 karakterlik bir gerekçe yazmalısın.');
      return;
    }
    try {
      await review.mutateAsync({ propertyId: property.id, approve, note: note.trim() || null });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.');
    }
  };

  return (
    <ModalSheet
      visible={Boolean(property)}
      onClose={close}
      title={property.name}
      subtitle={`${PROPERTY_TYPE_LABELS[property.property_type]} · ${property.owner.display_name ?? property.owner.username}`}
      maxWidth={620}
      footer={
        <View style={styles.footer}>
          <Button
            label={confirmReject ? 'Reddi onayla' : 'Reddet'}
            variant="danger"
            fullWidth={false}
            loading={review.isPending}
            onPress={() => {
              if (confirmReject) void decide(false);
              else setConfirmReject(true);
            }}
          />
          <Button
            label="Doğrula ve yayınla"
            fullWidth={false}
            loading={review.isPending}
            disabled={property.missing.length > 0}
            onPress={() => void decide(true)}
          />
        </View>
      }
    >
      <View style={{ gap: 12 }}>
        {error ? (
          <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger }]}>
            <AppText variant="caption" color="danger">{error}</AppText>
          </View>
        ) : null}

        <View style={styles.detailGrid}>
          <Detail label="Durum" value={PROPERTY_STATUS_LABELS[property.status]} />
          <Detail label="Doğrulama" value={VERIFICATION_STATUS_LABELS[property.verification_status]} />
          <Detail label="Tesis türü" value={PROPERTY_TYPE_LABELS[property.property_type]} />
          <Detail label="İlçe" value={property.district ?? '—'} />
          <Detail label="Telefon" value={property.phone ?? '—'} />
          <Detail label="E-posta" value={property.email ?? '—'} />
          <Detail label="Vergi no" value={property.tax_number ?? '—'} />
          <Detail label="Kapasite" value={`${property.room_type_count} tip / ${property.room_count} oda`} />
        </View>

        <View>
          <AppText variant="label" color="textSecondary" style={styles.blockLabel}>Adres</AppText>
          <AppText variant="body">{property.address ?? 'Adres girilmedi'}</AppText>
        </View>

        <View>
          <AppText variant="label" color="textSecondary" style={styles.blockLabel}>
            Eksik zorunlu bilgiler ({property.missing.length})
          </AppText>
          {property.missing.length === 0 ? (
            <AppText variant="caption" color="success">Tesis yayına hazır görünüyor.</AppText>
          ) : (
            <View style={styles.missingList}>
              {property.missing.map((missing) => (
                <View key={missing} style={[styles.missingChip, { backgroundColor: theme.colors.warningSoft }]}>
                  <Ionicons name="alert-circle-outline" size={11} color={theme.colors.warning} />
                  <AppText variant="caption" color="warning">{missing}</AppText>
                </View>
              ))}
            </View>
          )}
        </View>

        <View>
          <AppText variant="label" color="textSecondary" style={styles.blockLabel}>
            Belgeler ({property.documents.length})
          </AppText>
          {property.documents.length === 0 ? (
            <AppText variant="caption" color="warning">Belge yüklenmemiş. Doğrulama için gerekli belgeleri isteyin.</AppText>
          ) : (
            <View style={{ gap: 6 }}>
              {property.documents.map((document) => (
                <View key={document.id} style={[styles.docRow, { borderColor: theme.colors.border }]}>
                  <Ionicons name="document-text-outline" size={15} color={theme.colors.textSecondary} />
                  <View style={styles.flex}>
                    <AppText variant="caption" numberOfLines={1}>{document.title}</AppText>
                    <AppText variant="caption" color="textTertiary">
                      {document.kind} · {document.status === 'approved' ? 'Onaylı' : document.status === 'rejected' ? 'Reddedildi' : 'Bekliyor'}
                    </AppText>
                  </View>
                  <Button label="Aç" size="sm" variant="ghost" fullWidth={false} onPress={() => void openDocument(document.storage_path)} />
                </View>
              ))}
            </View>
          )}
        </View>

        {confirmReject ? (
          <View style={[styles.rejectBox, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="warning-outline" size={16} color={theme.colors.danger} />
            <AppText variant="caption" color="danger" style={styles.flex}>
              Reddetme tesisin yayınını kaldırır ve doğrulama durumunu reddedildi yapar. Açıklama zorunludur.
            </AppText>
          </View>
        ) : null}

        <TextField
          label={confirmReject ? 'Red gerekçesi *' : 'Doğrulama notu'}
          value={note}
          onChangeText={setNote}
          placeholder="Belge eksikliği, adres uyuşmazlığı veya onay notu…"
          multiline
        />
      </View>
    </ModalSheet>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <AppText variant="caption" color="textTertiary">{label}</AppText>
      <AppText variant="caption" color="text" numberOfLines={2}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: {
    flex: 1,
    minWidth: 140,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 11,
    gap: 2,
  },
  statIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  card: {
    width: '32%',
    minWidth: 290,
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 7,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'center' },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detail: { width: '31%', minWidth: 140, gap: 1 },
  blockLabel: { marginBottom: 4 },
  missingList: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  missingChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  rejectBox: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 8 },
  errorBox: { padding: 9, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  footer: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  syncMetaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  syncMetaCell: {
    flex: 1,
    minWidth: 130,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 9,
    gap: 2,
  },
  syncBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 9, borderRadius: 9 },
  syncActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  syncProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    padding: 9,
  },
  syncRun: { gap: 4, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  claimRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 10,
  },
  claimActions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
});
