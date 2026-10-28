import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Skeleton } from '@/components/ui';
import { AdminPage, AdminSection } from '@/features/admin/components/AdminPage';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { AdminAccessDenied, AdminEmptyState, AdminQueryState } from '@/features/explore/admin/AdminExploreShared';
import { formatDate, formatNumber } from '@/features/explore/admin/labels';
import { useExploreHealth } from '@/features/explore/hooks/use-explore';
import { useTheme } from '@/theme/ThemeProvider';

export default function AdminExploreHealthScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const me = useAdminMe();
  const permissions = me.data?.permissions ?? [];
  const canView = permissions.includes('map.view') || permissions.includes('realestate.view');
  const query = useExploreHealth(canView);

  return (
    <AdminPage
      title="Harita veri sağlığı"
      subtitle="İşletme ve emlak kayıtlarının veri kalitesi, mükerrer kayıtlar, mekânsal sorgu gecikmesi ve servis durumu."
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
      actions={
        <>
          <Button
            label="Harita yönetimi"
            size="sm"
            variant="outline"
            fullWidth={false}
            leftIcon={<Ionicons name="map-outline" size={14} color={theme.colors.text} />}
            onPress={() => router.push('/admin/explore' as never)}
          />
          <Button
            label="Emlak yönetimi"
            size="sm"
            variant="secondary"
            fullWidth={false}
            leftIcon={<Ionicons name="home-outline" size={14} color={theme.colors.primaryDeep} />}
            onPress={() => router.push('/admin/real-estate' as never)}
          />
        </>
      }
    >
      {me.isLoading ? (
        <View style={styles.stack}>
          <Skeleton height={240} radius={14} />
          <Skeleton height={160} radius={14} />
        </View>
      ) : !canView ? (
        <AdminAccessDenied message="Veri sağlığı ekranı için map.view veya realestate.view izni gerekir." />
      ) : (
        <AdminQueryState
          loading={query.isLoading}
          error={query.isError ? query.error.message : null}
          onRetry={() => void query.refetch()}
        >
          {query.data ? <HealthContent data={query.data} /> : null}
        </AdminQueryState>
      )}
    </AdminPage>
  );
}

function HealthContent({ data }: { data: NonNullable<ReturnType<typeof useExploreHealth>['data']> }) {
  const { theme } = useTheme();
  const invalidTotal =
    data.places.missing_address +
    data.places.invalid_coordinates +
    data.places.without_photo +
    data.places.without_category +
    data.places.without_neighborhood;
  const spatialTone =
    data.spatial_query.status === 'ok' ? 'success' : data.spatial_query.status === 'slow' ? 'warning' : 'danger';
  const mapReady = data.map_service.status === 'ready' || data.map_service.status === 'ok';

  return (
    <>
      <View style={[styles.generated, { borderColor: theme.colors.border }]}>
        <Ionicons name="time-outline" size={15} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
          Rapor üretimi: {formatDate(data.generated_at)}
        </AppText>
        <Badge
          label={mapReady ? 'Harita servisi hazır' : 'Harita servisi bağımlı'}
          tone={mapReady ? 'success' : 'danger'}
        />
        <Badge
          label={`EİDS: ${data.eids.enabled ? 'etkin' : 'kapalı'}`}
          tone={data.eids.enabled ? 'success' : 'warning'}
        />
      </View>

      <StatGrid>
        <StatCard label="Toplam işletme" value={formatNumber(data.places.total)} icon="storefront-outline" hint={`${formatNumber(data.places.published)} yayında`} />
        <StatCard
          label="Doğrulanmış"
          value={formatNumber(data.places.verified)}
          icon="shield-checkmark-outline"
          tone="success"
          hint="Belge ve sahiplik incelemesi tamamlanmış"
        />
        <StatCard
          label="Veri eksikliği"
          value={formatNumber(invalidTotal)}
          icon="alert-circle-outline"
          tone={invalidTotal > 0 ? 'warning' : 'success'}
          hint="Adres, konum, medya veya kategori eksikleri"
        />
        <StatCard
          label="Mükerrer işletme"
          value={formatNumber(data.places.duplicates)}
          icon="copy-outline"
          tone={data.places.duplicates > 0 ? 'warning' : 'success'}
          hint="Yakın konum + benzer ad"
        />
        <StatCard
          label="Emlak ilanı"
          value={formatNumber(data.real_estate.total)}
          icon="home-outline"
          tone="accent"
          hint={`${formatNumber(data.real_estate.published)} yayında · ${formatNumber(data.real_estate.pending)} bekliyor`}
        />
        <StatCard
          label="Emlak veri eksikliği"
          value={formatNumber(data.real_estate.missing_public_location + data.real_estate.without_approved_media)}
          icon="images-outline"
          tone={data.real_estate.missing_public_location + data.real_estate.without_approved_media > 0 ? 'warning' : 'success'}
          hint={`${formatNumber(data.real_estate.missing_public_location)} konum · ${formatNumber(data.real_estate.without_approved_media)} medya`}
        />
      </StatGrid>

      <AdminSection title="İşletme veri kalitesi" subtitle="Bu sayılar yalnızca gerçek kayıtlardan hesaplanır; örnek veya varsayılan veri yoktur.">
        <View style={styles.metricGrid}>
          <Metric label="Yayında" value={data.places.published} />
          <Metric label="Eksik adres" value={data.places.missing_address} warn />
          <Metric label="Geçersiz koordinat" value={data.places.invalid_coordinates} warn />
          <Metric label="Fotoğrafsız" value={data.places.without_photo} warn />
          <Metric label="Kategorisiz" value={data.places.without_category} warn />
          <Metric label="Mahallesiz" value={data.places.without_neighborhood} warn />
          <Metric label="Mükerrer" value={data.places.duplicates} warn />
        </View>
      </AdminSection>

      <AdminSection title="Kuyruklar ve emlak kalitesi" subtitle="Bekleyen kayıtlar ilgili moderasyon sekmesinden işlenir.">
        <View style={styles.metricGrid}>
          {Object.entries(data.queue).map(([key, value]) => (
            <Metric key={key} label={queueLabel(key)} value={value} warn />
          ))}
          <Metric label="Emlak taslak" value={data.real_estate.draft} />
          <Metric label="Emlak reddedilen" value={data.real_estate.rejected} warn />
          <Metric label="Emlak süresi dolan" value={data.real_estate.expired} warn />
        </View>
      </AdminSection>

      <AdminSection title="Coğrafi sorgu ve servis durumu" subtitle="Gecikme sunucudaki örnek mekânsal sorgudan ölçülür.">
        <View style={styles.serviceRow}>
          <View style={[styles.serviceCard, { borderColor: theme.colors.border }]}>
            <Badge label={`PostGIS: ${data.spatial_query.status}`} tone={spatialTone} />
            <AppText variant="h2">{formatNumber(data.spatial_query.latency_ms)} ms</AppText>
            <AppText variant="caption" color="textTertiary">
              {data.spatial_query.sample}
            </AppText>
          </View>
          <View style={[styles.serviceCard, { borderColor: theme.colors.border }]}>
            <Badge label={`Harita sağlayıcı: ${data.map_service.status}`} tone={mapReady ? 'success' : 'warning'} />
            <AppText variant="caption" color="textSecondary">
              {data.map_service.reason}
            </AppText>
          </View>
          <View style={[styles.serviceCard, { borderColor: theme.colors.border }]}>
            <Badge label={`EİDS: ${data.eids.status}`} tone={data.eids.enabled ? 'success' : 'danger'} />
            <AppText variant="caption" color="textSecondary">
              {data.eids.note}
            </AppText>
          </View>
        </View>
      </AdminSection>

      <AdminSection
        title="Mükerrer işletme örnekleri"
        subtitle="Benzer ad ve yakın konum. Birleştirme işlemi işletme detay ekranından yapılır."
        action={<Badge label={`${data.duplicate_samples.length} örnek`} tone={data.duplicate_samples.length > 0 ? 'warning' : 'success'} />}
      >
        {data.duplicate_samples.length === 0 ? (
          <AdminEmptyState
            icon="checkmark-done-outline"
            title="Mükerrer kayıt bulunmadı"
            text="Benzer ad ve yakın konum eşleşmesi yok."
          />
        ) : (
          <View style={styles.list}>
            {data.duplicate_samples.map((item) => (
              <View
                key={`${item.id_a}-${item.id_b}`}
                style={[styles.duplicateRow, { borderColor: theme.colors.border }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="caption" style={{ fontWeight: '700' }}>
                    {item.name_a} ↔ {item.name_b}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {item.district || 'İlçe yok'} · {formatNumber(item.distance_m)} m · ad benzerliği{' '}
                    {(item.name_score * 100).toFixed(0)}%
                  </AppText>
                </View>
                <Badge label="İncele" tone="warning" />
              </View>
            ))}
          </View>
        )}
      </AdminSection>
    </>
  );
}

function Metric({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.metric,
        {
          borderColor: warn && value > 0 ? theme.colors.warning : theme.colors.border,
          backgroundColor: warn && value > 0 ? theme.colors.warningSoft : theme.colors.surfaceMuted,
        },
      ]}
    >
      <AppText variant="h3" color={warn && value > 0 ? 'warning' : 'text'}>
        {formatNumber(value)}
      </AppText>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

function queueLabel(key: string) {
  const labels: Record<string, string> = {
    place_suggestions: 'Yer önerisi',
    place_claims: 'Sahiplik',
    place_media: 'İşletme medyası',
    place_reports: 'İşletme şikâyeti',
    re_verifications: 'EİDS doğrulama',
    re_media: 'Emlak medyası',
    re_listings: 'Emlak ilanı',
    re_reports: 'Emlak şikâyeti',
  };
  return labels[key] ?? key.replaceAll('_', ' ');
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  generated: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: {
    flexGrow: 1,
    flexBasis: 132,
    minWidth: 112,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 1,
  },
  serviceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  serviceCard: {
    flexGrow: 1,
    flexBasis: 220,
    padding: 12,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 5,
  },
  list: { gap: 7 },
  duplicateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
