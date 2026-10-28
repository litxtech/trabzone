import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { NewsDeletionModal } from '@/features/admin/components/news-api/NewsDeletionModal';
import { NewsSettingsModal } from '@/features/admin/components/news-api/NewsSettingsModal';
import { NewsWizardModal } from '@/features/admin/components/news-api/NewsWizardModal';
import {
  CONNECTOR_LABELS,
  HealthBadge,
  LicenseBadge,
  MODE_LABELS,
  StatusBadge,
  newsApiStyles,
} from '@/features/admin/components/news-api/shared';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import {
  useNewsApiConnections,
  useNewsApiCatalog,
  useNewsApiDeletionJobs,
  useNewsApiOverview,
  useNewsApiSetStatus,
  useNewsApiTest,
} from '@/features/admin/hooks/use-admin-news-api';
import type { NewsConnection, NewsStatus } from '@/features/news-api/types';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';
import { useRouter } from '@/utils/router';

type StatusFilter = NewsStatus | 'all';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'active', label: 'Açık' },
  { key: 'paused', label: 'Duraklatıldı' },
  { key: 'disabled', label: 'Kapalı' },
  { key: 'draft', label: 'Taslak' },
  { key: 'deleting', label: 'Siliniyor' },
];

const PAGE_SIZE = 20;

const numberFormat = new Intl.NumberFormat('tr-TR');

const SCOPE_LABELS: Record<string, string> = {
  disable_only: 'Kaynağı kapat',
  remove_content: 'Haberlerle kaldır',
  purge: 'Tamamen sil',
};

export default function AdminNewsApiScreen() {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const router = useRouter();
  const toast = useAdminToast();

  const me = useAdminMe();
  const canManage = (me.data?.permissions ?? []).includes('news.manage');

  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<NewsConnection | null>(null);

  const overview = useNewsApiOverview();
  const catalog = useNewsApiCatalog();
  const connections = useNewsApiConnections({
    search: query,
    status: status === 'all' ? null : status,
    limit: PAGE_SIZE,
    offset,
  });
  const deletionJobs = useNewsApiDeletionJobs(null);
  const setStatusMutation = useNewsApiSetStatus();
  const testMutation = useNewsApiTest();

  const stats = overview.data;
  const rows = connections.data?.items ?? [];
  const total = connections.data?.total ?? 0;

  const latestJobs = useMemo(() => (deletionJobs.data?.items ?? []).slice(0, 6), [deletionJobs.data]);

  const toggleSource = async (row: NewsConnection) => {
    const target = row.status === 'active' ? 'paused' : 'active';
    try {
      await setStatusMutation.mutateAsync({ id: row.id, status: target });
      toast.success(target === 'active' ? 'Kaynak açıldı; yeni haberler akışa alınacak.' : 'Kaynak duraklatıldı; yeni çekim durdu.');
    } catch (toggleError) {
      toast.error(errorMessage(toggleError, 'Durum değiştirilemedi.'));
    }
  };

  const runTest = async (row: NewsConnection) => {
    try {
      const result = await testMutation.mutateAsync({ connectionId: row.id });
      if (result.ok) toast.success(`Bağlantı başarılı · HTTP ${result.http_status ?? '—'} · ${result.item_count} haber`);
      else toast.error(result.error ?? 'Bağlantı testi başarısız.');
    } catch (testError) {
      toast.error(errorMessage(testError, 'Test isteği gönderilemedi.'));
    }
  };

  return (
    <AdminPage
      title="API ve Kaynak Yönetimi"
      subtitle="RSS, Atom, XML, JSON Feed ve REST API kaynaklarını kod yazmadan bağla; yayın kurallarını, lisansı ve silme süreçlerini yönet."
      actions={
        <>
          <Button
            label="Ayarlar"
            size="sm"
            variant="outline"
            fullWidth={false}
            leftIcon={<Ionicons name="options-outline" size={15} color={theme.colors.text} />}
            onPress={() => setSettingsOpen(true)}
          />
          <Button
            label="Yeni Haber Kaynağı Ekle"
            size="sm"
            fullWidth={false}
            disabled={!canManage || !catalog.data}
            leftIcon={<Ionicons name="add" size={16} color={theme.colors.onPrimary} />}
            onPress={() => setWizardOpen(true)}
          />
        </>
      }
      refreshing={overview.isFetching || connections.isFetching}
      onRefresh={() => {
        void overview.refetch();
        void connections.refetch();
        void deletionJobs.refetch();
      }}
    >
      <StatGrid>
        <StatCard
          label="Toplam kaynak"
          value={numberFormat.format(stats?.connections_total ?? 0)}
          icon="git-network-outline"
          hint={`${stats?.connections_active ?? 0} açık · ${stats?.connections_paused ?? 0} duraklatıldı`}
        />
        <StatCard
          label="Çekilen haber"
          value={numberFormat.format(stats?.items_total ?? 0)}
          icon="download-outline"
          tone="accent"
          hint={`Son 24s: ${numberFormat.format(stats?.items_24h ?? 0)}`}
        />
        <StatCard
          label="Yayımlanan"
          value={numberFormat.format(stats?.published_total ?? 0)}
          icon="paper-plane-outline"
          tone="success"
          hint={`Son 24s: ${numberFormat.format(stats?.published_24h ?? 0)} · Bekleyen: ${numberFormat.format(stats?.items_pending ?? 0)}`}
        />
        <StatCard
          label="Engellenen / tekrar"
          value={`${numberFormat.format(stats?.items_blocked ?? 0)} / ${numberFormat.format(stats?.items_duplicate ?? 0)}`}
          icon="shield-outline"
          tone="warning"
          hint={`${stats?.connections_error ?? 0} kaynakta hata`}
        />
        <StatCard
          label="Bugünkü istek"
          value={numberFormat.format(stats?.requests_today ?? 0)}
          icon="pulse-outline"
          hint={stats?.avg_response_ms != null ? `Ort. ${stats.avg_response_ms} ms` : 'Ölçüm yok'}
        />
        <StatCard
          label="Lisanssız kaynak"
          value={numberFormat.format(stats?.unlicensed_sources ?? 0)}
          icon="document-text-outline"
          tone={(stats?.unlicensed_sources ?? 0) > 0 ? 'danger' : 'success'}
          hint={`${stats?.deletions_running ?? 0} silme işi sürüyor`}
        />
      </StatGrid>

      <AdminSection
        title="Haber kaynakları"
        subtitle="Aç/kapat, test et, düzenle veya kaynağı haberleriyle birlikte kaldır."
        action={
          <View style={newsApiStyles.row}>
            <TextField
              value={search}
              onChangeText={setSearch}
              placeholder="Kaynak adı veya adres ara"
              containerStyle={styles.search}
              onSubmitEditing={() => {
                setQuery(search);
                setOffset(0);
              }}
            />
            <Button
              label="Ara"
              size="sm"
              variant="outline"
              fullWidth={false}
              onPress={() => {
                setQuery(search);
                setOffset(0);
              }}
            />
          </View>
        }
      >
        <FilterChips
          options={STATUS_FILTERS.map((filter) => ({ ...filter }))}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setOffset(0);
          }}
        />

        {connections.isLoading ? (
          <ActivityIndicator />
        ) : rows.length === 0 ? (
          <View style={[styles.empty, { borderColor: theme.colors.border }]}>
            <Ionicons name="cloud-offline-outline" size={20} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary" style={newsApiStyles.flex}>
              Bu filtrede kaynak yok. “Yeni Haber Kaynağı Ekle” ile RSS, JSON Feed veya REST API bağlayabilirsin.
            </AppText>
          </View>
        ) : (
          <View style={styles.list}>
            {rows.map((row) => (
              <View
                key={row.id}
                style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
              >
                <View style={styles.cardHead}>
                  <View style={styles.cardTitle}>
                    <View style={newsApiStyles.row}>
                      <AppText variant="title" numberOfLines={1}>
                        {row.name}
                      </AppText>
                      <StatusBadge status={row.status} />
                      <HealthBadge health={row.health_status} />
                      <LicenseBadge status={row.license_status} />
                      {row.auto_publish_enabled ? <Badge label="Otomatik yayın" tone="success" /> : null}
                    </View>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {CONNECTOR_LABELS[row.connector_kind] ?? row.connector_kind} · {row.feed_url}
                    </AppText>
                  </View>
                  <View style={styles.cardActions}>
                    <Button
                      label={row.status === 'active' ? 'Duraklat' : 'Aç'}
                      size="sm"
                      variant={row.status === 'active' ? 'outline' : 'secondary'}
                      fullWidth={false}
                      disabled={!canManage || row.status === 'deleting'}
                      loading={setStatusMutation.isPending}
                      onPress={() => void toggleSource(row)}
                    />
                    <Button
                      label="Test Et"
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      disabled={!canManage || row.status === 'deleting'}
                      loading={testMutation.isPending}
                      onPress={() => void runTest(row)}
                    />
                    <Button
                      label="Detay"
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      onPress={() => router.push(`/admin/news-api/${row.id}` as never)}
                    />
                    <Button
                      label="Sil"
                      size="sm"
                      variant="danger"
                      fullWidth={false}
                      disabled={!canManage || row.status === 'deleting'}
                      onPress={() => setDeletionTarget(row)}
                    />
                  </View>
                </View>

                <View style={styles.metrics}>
                  <Metric label="Haber" value={numberFormat.format(row.stats.items_total)} />
                  <Metric label="Yayında" value={numberFormat.format(row.stats.items_published)} />
                  <Metric label="İnceleme" value={numberFormat.format(row.stats.items_pending)} />
                  <Metric label="Sitemap" value={numberFormat.format(row.stats.sitemap_urls)} />
                  <Metric
                    label="Günlük istek"
                    value={`${row.requests_today}/${row.daily_request_budget}`}
                    hint={row.rate_limited_until ? `Limit: ${formatDateTimeTr(row.rate_limited_until)}` : undefined}
                  />
                  <Metric
                    label="Son kontrol"
                    value={row.last_checked_at ? formatDateTimeTr(row.last_checked_at) : '—'}
                    hint={row.last_response_ms != null ? `${row.last_response_ms} ms` : undefined}
                  />
                  <Metric label="Yayın modu" value={MODE_LABELS[row.publish_mode] ?? row.publish_mode} />
                </View>

                {row.last_error ? (
                  <View style={[styles.errorRow, { backgroundColor: theme.colors.dangerSoft }]}>
                    <Ionicons name="alert-circle-outline" size={14} color={theme.colors.danger} />
                    <AppText variant="caption" color="danger" numberOfLines={2} style={newsApiStyles.flex}>
                      {row.last_error}
                      {row.last_error_at ? ` · ${formatDateTimeTr(row.last_error_at)}` : ''}
                    </AppText>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}

        <Pager total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
      </AdminSection>

      <AdminSection
        title="Silme ve kaldırma işleri"
        subtitle="Toplu kaldırma işleri yeniden denenebilir ve kaynak bazında izlenir."
      >
        {latestJobs.length === 0 ? (
          <AppText variant="caption" color="textTertiary">
            Henüz silme işi yok. Bir kaynağı kaldırdığında işlem sonuçları burada listelenir.
          </AppText>
        ) : (
          <View style={styles.list}>
            {latestJobs.map((job) => (
              <View
                key={job.id}
                style={[styles.jobRow, { borderColor: theme.colors.border }]}
              >
                <View style={newsApiStyles.flex}>
                  <AppText variant="label">{SCOPE_LABELS[job.scope] ?? job.scope}</AppText>
                  <AppText variant="caption" color="textTertiary">
                    {formatDateTimeTr(job.requested_at)} · {numberFormat.format(job.counts.items_total)} haber ·{' '}
                    {numberFormat.format(job.counts.sitemap_urls)} sitemap URL
                  </AppText>
                </View>
                <Badge
                  label={
                    job.status === 'completed'
                      ? 'Tamamlandı'
                      : job.status === 'failed'
                        ? 'Başarısız'
                        : job.status === 'cancelled'
                          ? 'İptal'
                          : job.status === 'running'
                            ? 'Sürüyor'
                            : 'Kuyrukta'
                  }
                  tone={
                    job.status === 'completed'
                      ? 'success'
                      : job.status === 'failed'
                        ? 'danger'
                        : job.status === 'cancelled'
                          ? 'neutral'
                          : 'warning'
                  }
                />
              </View>
            ))}
          </View>
        )}
      </AdminSection>

      {compact ? null : (
        <AppText variant="caption" color="textTertiary">
          Kaynak ekleme adımları: tür → bağlantı → test → alan eşleştirme → kategori/konum → lisans ve yayın modu →
          etkinleştir. Etkinleştirme yalnızca başarılı sunucu testi ve zorunlu alan eşleştirmesiyle mümkündür.
        </AppText>
      )}

      <NewsWizardModal
        visible={wizardOpen}
        catalog={catalog.data ?? { categories: [], districts: [], templates: [], publish_modes: [], connector_kinds: [], license_statuses: [] }}
        onClose={() => setWizardOpen(false)}
        onCreated={() => {
          setWizardOpen(false);
          void connections.refetch();
          void overview.refetch();
        }}
      />

      <NewsSettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {deletionTarget ? (
        <NewsDeletionModal
          visible
          connectionId={deletionTarget.id}
          connectionName={deletionTarget.name}
          canDelete={canManage}
          onClose={() => setDeletionTarget(null)}
          onCompleted={() => {
            void connections.refetch();
            void overview.refetch();
            void deletionJobs.refetch();
          }}
        />
      ) : null}
    </AdminPage>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.metric}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <AppText variant="caption" color="textSecondary" numberOfLines={1}>
        {value}
      </AppText>
      {hint ? (
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { width: 240 },
  list: { gap: 9 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 12, gap: 9 },
  cardHead: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' },
  cardTitle: { flex: 1, minWidth: 240, gap: 4 },
  cardActions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { minWidth: 94, gap: 1 },
  errorRow: { flexDirection: 'row', gap: 6, alignItems: 'center', borderRadius: 9, paddingHorizontal: 9, paddingVertical: 6 },
  empty: { flexDirection: 'row', gap: 8, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12 },
  jobRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 11,
  },
});
