import { Ionicons } from '@expo/vector-icons';
import { useMemo, type ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { AdminPage, AdminSection } from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useSystemHealth } from '@/features/admin/hooks/use-admin';
import type { SystemHealth } from '@/features/admin/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

function formatBytes(bytes: number | null | undefined): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** index;
  return `${scaled.toFixed(scaled >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

const integrationTone = (status: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  const normalized = (status || '').toLowerCase();
  if (['ok', 'healthy', 'active', 'connected', 'operational'].includes(normalized)) return 'success';
  if (['degraded', 'warning', 'pending', 'unknown', 'configured'].includes(normalized)) return 'warning';
  if (['down', 'error', 'failed', 'offline'].includes(normalized)) return 'danger';
  return 'neutral';
};

const severityTone = (severity: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  const normalized = (severity || '').toLowerCase();
  if (['critical', 'fatal', 'error'].includes(normalized)) return 'danger';
  if (['warning', 'warn'].includes(normalized)) return 'warning';
  if (['info', 'debug'].includes(normalized)) return 'neutral';
  return 'neutral';
};

export default function AdminSystemScreen() {
  const { theme } = useTheme();
  const system = useSystemHealth();
  const data = system.data;

  const errorColumns: Column<SystemHealth['errors']['recent'][number]>[] = [
    {
      key: 'error',
      label: 'Hata',
      width: 2.4,
      render: (row) => (
        <View style={{ gap: 1 }}>
          <View style={styles.rowWrap}>
            <Badge label={row.severity} tone={severityTone(row.severity)} />
            <AppText variant="caption" style={{ fontFamily: 'monospace', color: theme.colors.textSecondary }}>
              {row.error_code}
            </AppText>
          </View>
          <AppText variant="caption" color="textSecondary" numberOfLines={2}>
            {row.message}
          </AppText>
        </View>
      ),
    },
    {
      key: 'source',
      label: 'Kaynak',
      width: 0.8,
      hideOnMobile: true,
      render: (row) => <Badge label={row.source} tone="neutral" />,
    },
    {
      key: 'time',
      label: 'Zaman',
      width: 1,
      render: (row) => (
        <View style={{ gap: 1 }}>
          <AppText variant="caption" color="textSecondary">
            {formatDateTimeTr(row.occurred_at)}
          </AppText>
          <Badge label={row.resolved_at ? 'Çözüldü' : 'Açık'} tone={row.resolved_at ? 'success' : 'danger'} />
        </View>
      ),
    },
  ];

  const storageBuckets = useMemo(
    () => [...(data?.storage.buckets ?? [])].sort((a, b) => b.size_bytes - a.size_bytes),
    [data?.storage.buckets],
  );

  return (
    <AdminPage
      title="Sistem ve Entegrasyonlar"
      subtitle="Veritabanı, storage, medya işleme, hata kayıtları ve servis durumu."
      refreshing={system.isRefetching}
      onRefresh={() => void system.refetch()}
      actions={
        <Button
          label="Yenile"
          size="sm"
          variant="secondary"
          fullWidth={false}
          loading={system.isFetching}
          leftIcon={<Ionicons name="refresh-outline" size={15} color={theme.colors.primary} />}
          onPress={() => void system.refetch()}
        />
      }
    >
      <StatGrid>
        <StatCard label="Veritabanı boyutu" value={formatBytes(data?.database.size_bytes)} icon="server-outline" hint={`${data?.database.tables ?? 0} tablo`} />
        <StatCard label="Storage kullanımı" value={formatBytes(data?.storage.size_bytes)} icon="cloud-outline" hint={`${data?.storage.objects ?? 0} nesne`} />
        <StatCard label="Açık hata" value={String(data?.errors.open ?? 0)} icon="bug-outline" tone={data?.errors.open ? 'danger' : 'success'} hint={`Son 24 saat: ${data?.errors.last_24h ?? 0}`} />
        <StatCard label="İşlenen Reels" value={String(data?.reels.processing ?? 0)} icon="film-outline" tone={data?.reels.processing ? 'warning' : 'primary'} hint="Kuyrukta bekleyen" />
        <StatCard label="Başarısız Reels (24 sa)" value={String(data?.reels.failed_24h ?? 0)} icon="warning-outline" tone={data?.reels.failed_24h ? 'danger' : 'success'} hint="İşleme hatası" />
        <StatCard label="Hazır Reels" value={String(data?.reels.ready ?? 0)} icon="checkmark-circle-outline" tone="success" hint="Yayına hazır" />
        <StatCard label="Kullanıcı" value={String(data?.counts['profiles'] ?? 0)} icon="people-outline" hint="Toplam profil" />
        <StatCard label="Sunucu saati" value={data?.database.server_time ? formatDateTimeTr(data.database.server_time).split(' ').slice(-1)[0] ?? '—' : '—'} icon="time-outline" hint="Veritabanı UTC+3" />
      </StatGrid>

      <AdminSection
        title="Entegrasyon durumu"
        subtitle="Gizli anahtarlar ve secret değerler bu ekranda gösterilmez."
        action={<Badge label={`${data?.integrations.length ?? 0} servis`} tone="primary" />}
      >
        <View style={styles.integrationGrid}>
          {(data?.integrations ?? []).map((integration) => (
            <View
              key={integration.key}
              style={[styles.integrationCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]}
            >
              <View style={[styles.integrationIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="git-network-outline" size={17} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="caption" style={{ fontWeight: '700' }}>
                  {integration.label}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                  {integration.detail ?? 'Detay yok'}
                </AppText>
                {integration.last_checked_at ? (
                  <AppText variant="caption" color="textTertiary">
                    {formatDateTimeTr(integration.last_checked_at)}
                  </AppText>
                ) : null}
              </View>
              <Badge label={integration.status} tone={integrationTone(integration.status)} />
            </View>
          ))}
        </View>
      </AdminSection>

      <AdminSection title="Storage kovaları" subtitle="Bucket bazında nesne ve boyut dağılımı">
        <View style={{ gap: 7 }}>
          {storageBuckets.length === 0 ? (
            <AppText variant="caption" color="textTertiary" style={{ paddingVertical: 12 }}>
              Storage verisi yok.
            </AppText>
          ) : (
            storageBuckets.map((bucket) => {
              const pct = data?.storage.size_bytes
                ? Math.max(2, Math.round((bucket.size_bytes / data.storage.size_bytes) * 100))
                : 0;
              return (
                <View key={bucket.bucket_id} style={{ gap: 4 }}>
                  <View style={styles.rowBetween}>
                    <AppText variant="caption" style={{ fontWeight: '600' }}>
                      {bucket.bucket_id}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {bucket.objects} nesne · {formatBytes(bucket.size_bytes)}
                    </AppText>
                  </View>
                  <View style={[styles.barTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
                    <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: theme.colors.primary }]} />
                  </View>
                </View>
              );
            })
          )}
        </View>
      </AdminSection>

      <View style={styles.twoCol}>
        <AdminSection title="Uygulama sürümleri" subtitle="Aktif cihaz dağılımı" style={{ flex: 1, minWidth: 280 }}>
          <Distribution rows={data?.app_versions ?? []} />
        </AdminSection>
        <AdminSection title="Platform dağılımı" subtitle="iOS / Android / Web" style={{ flex: 1, minWidth: 280 }}>
          <Distribution rows={data?.platforms ?? []} />
        </AdminSection>
      </View>

      <AdminSection
        title="Sunucu hata kayıtları"
        subtitle="İstemci ve sunucu taraflı son hatalar (hassas veriler maskelenir)."
        action={<Badge label={`${data?.errors.open ?? 0} açık`} tone={data?.errors.open ? 'danger' : 'success'} />}
      >
        <DataTable
          columns={errorColumns}
          rows={data?.errors.recent ?? []}
          keyExtractor={(row) => row.id}
          loading={system.isLoading}
          empty={
            <View style={styles.empty}>
              <Ionicons name="checkmark-circle-outline" size={22} color={theme.colors.success} />
              <AppText variant="caption" color="textSecondary">
                Kayıtlı hata yok.
              </AppText>
            </View>
          }
        />
      </AdminSection>

      <AdminSection title="Güvenli yapılandırma" subtitle="Üretim ortamı politikaları">
        <SystemLine icon="key-outline" label="Service role anahtarı" value="Yalnızca sunucu" />
        <SystemLine icon="lock-closed-outline" label="Secret değerler" value="Gizli" />
        <SystemLine icon="shield-checkmark-outline" label="RLS koruması" value="Aktif" />
        <SystemLine icon="pulse-outline" label="Sağlık kontrolü" value="60 sn'de bir" />
      </AdminSection>
    </AdminPage>
  );
}

function Distribution({ rows }: { rows: { label: string; value: number }[] }) {
  const { theme } = useTheme();
  const total = rows.reduce((sum, row) => sum + Number(row.value ?? 0), 0);
  if (rows.length === 0) {
    return (
      <AppText variant="caption" color="textTertiary" style={{ paddingVertical: 12 }}>
        Veri yok.
      </AppText>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {rows.map((row) => {
        const pct = total > 0 ? Math.round((Number(row.value) / total) * 100) : 0;
        return (
          <View key={row.label} style={{ gap: 4 }}>
            <View style={styles.rowBetween}>
              <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                {row.label || 'Bilinmeyen'}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {row.value} · %{pct}
              </AppText>
            </View>
            <View style={[styles.barTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
              <View style={[styles.barFill, { width: `${Math.max(pct, 2)}%`, backgroundColor: theme.colors.primary }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SystemLine({
  icon,
  label,
  value,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.systemLine, { borderColor: theme.colors.divider }]}>
      <Ionicons name={icon} size={16} color={theme.colors.primary} />
      <AppText variant="caption" style={{ flex: 1 }}>
        {label}
      </AppText>
      <Badge label={value} tone="neutral" />
    </View>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  barTrack: { height: 6, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  integrationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  integrationCard: { flexGrow: 1, flexBasis: 300, maxWidth: 460, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  integrationIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  twoCol: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 30 },
  systemLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
