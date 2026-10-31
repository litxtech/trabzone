import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { AdminSection, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { BarChart, HorizontalBars, TrendChart } from '@/features/admin/components/Charts';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import { useAdCampaigns, useAdsAnalytics, useAdsAudit, useAdsTargeting } from '../hooks';
import { CAMPAIGN_STATUS, formatCount, formatDateShort, formatMoneyCents } from '../labels';
import type { AdAuditItem, AdCampaignListItem } from '../types';

export function AnalyticsSection() {
  const { theme } = useTheme();
  const [days, setDays] = useState(30);
  const analytics = useAdsAnalytics(days);
  const data = analytics.data;
  const ctr = data && data.totals.impressions > 0 ? ((data.totals.clicks / data.totals.impressions) * 100).toFixed(2) : '0';

  return (
    <AdminSection
      title="Analitik"
      subtitle="Gösterim: banner en az %50 görünür ve en az 1 saniye ekranda kaldığında, sunucu doğrulamasından sonra sayılır. AdMob metrikleri bu tabloya karışmaz."
    >
      <FilterChips
        options={[
          { key: '7', label: 'Son 7 gün' },
          { key: '30', label: 'Son 30 gün' },
          { key: '90', label: 'Son 90 gün' },
          { key: '365', label: 'Son 1 yıl' },
        ]}
        value={String(days)}
        onChange={(value) => setDays(Number(value))}
      />
      {data ? (
        <>
          <StatGrid>
            <StatCard label="Gösterim" value={formatCount(data.totals.impressions)} icon="eye-outline" />
            <StatCard label="Tıklama" value={formatCount(data.totals.clicks)} icon="hand-left-outline" tone="accent" />
            <StatCard label="TO (CTR)" value={`%${ctr}`} icon="trending-up-outline" tone="success" />
            <StatCard label="Tekil erişim" value={formatCount(data.totals.reach)} icon="people-outline" />
            <StatCard label="Gelir" value={formatMoneyCents(data.totals.spend_cents)} icon="cash-outline" />
            <StatCard
              label="Reddedilen olay"
              value={formatCount(data.totals.invalid_events)}
              icon="shield-checkmark-outline"
              tone="warning"
              hint="Bot, hız sınırı, görünürlük"
            />
          </StatGrid>
          <AppText variant="title">Günlük gösterim</AppText>
          <TrendChart data={data.daily.map((item) => ({ label: item.day.slice(5), value: item.impressions }))} />
          <AppText variant="title">Günlük tıklama</AppText>
          <BarChart color={theme.colors.accent} data={data.daily.slice(-30).map((item) => ({ label: item.day.slice(8), value: item.clicks }))} />
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <AppText variant="title">Yerleşime göre gösterim</AppText>
              <HorizontalBars data={data.by_placement.filter((item) => item.impressions > 0 || item.enabled).map((item) => ({ label: item.label, value: item.impressions }))} />
            </View>
            <View style={styles.col}>
              <AppText variant="title">İlçeye göre gösterim</AppText>
              <HorizontalBars data={data.by_district.map((item) => ({ label: item.district, value: item.impressions }))} />
            </View>
          </View>
          <AppText variant="title">En çok gösterilen kampanyalar</AppText>
          {data.top_campaigns.length === 0 ? (
            <AppText variant="body" color="textSecondary">
              Bu dönemde gösterim yok.
            </AppText>
          ) : (
            data.top_campaigns.map((item) => (
              <View key={item.id} style={styles.listRow}>
                <AppText variant="body" style={styles.flex} numberOfLines={1}>
                  {item.name}
                </AppText>
                <Badge label={CAMPAIGN_STATUS[item.status].label} tone={CAMPAIGN_STATUS[item.status].tone} />
                <AppText variant="caption" color="textSecondary">
                  {formatCount(item.impressions)} · {formatCount(item.clicks)} tık · %{item.ctr}
                </AppText>
              </View>
            ))
          )}
        </>
      ) : (
        <AppText variant="body" color="textSecondary">
          {analytics.isError ? 'Analitik yüklenemedi.' : 'Yükleniyor…'}
        </AppText>
      )}
    </AdminSection>
  );
}

export function TargetingSection() {
  const targeting = useAdsTargeting();
  const data = targeting.data;
  return (
    <AdminSection
      title="Hedefleme"
      subtitle="Kampanyalar şehir ve ilçe seçilerek hedeflenir. Eşleşme, kullanıcının profilindeki şehir/ilçe veya ekrandaki ilçe filtresine göre yapılır. Kesin konum izni, reklam kimliği (IDFA/AAID) veya ilgi alanı profili kullanılmaz."
    >
      {data ? (
        <>
          <StatGrid>
            <StatCard
              label="Şehri belirsiz kullanıcı"
              value={formatCount(data.users_without_city)}
              icon="help-circle-outline"
              hint="Trabzon varsayılır"
            />
            <StatCard
              label="İlçesi belirsiz kullanıcı"
              value={formatCount(data.users_without_district)}
              icon="map-outline"
              hint="İlçe hedefli reklam görmez"
            />
            <StatCard
              label="Şehir seçmemiş kampanya"
              value={formatCount(data.untargeted_city_campaigns)}
              icon="globe-outline"
              hint="Tüm şehirlerde gösterilir"
            />
            <StatCard
              label="İlçe seçmemiş kampanya"
              value={formatCount(data.untargeted_campaigns)}
              icon="layers-outline"
              hint="Şehir genelinde gösterilir"
            />
          </StatGrid>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <AppText variant="title">Kullanıcıların şehirleri</AppText>
              <HorizontalBars data={data.profile_cities.slice(0, 12).map((item) => ({ label: item.city, value: item.users }))} />
            </View>
            <View style={styles.col}>
              <AppText variant="title">Kampanyaların hedeflediği şehirler</AppText>
              <HorizontalBars data={data.campaign_city_targets.slice(0, 12).map((item) => ({ label: item.city, value: item.campaigns }))} />
            </View>
          </View>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <AppText variant="title">Profillerdeki ilçeler</AppText>
              <HorizontalBars data={data.profile_districts.slice(0, 20).map((item) => ({ label: item.district, value: item.users }))} />
            </View>
            <View style={styles.col}>
              <AppText variant="title">Kampanyaların hedeflediği ilçeler</AppText>
              <HorizontalBars data={data.campaign_targets.map((item) => ({ label: item.district, value: item.campaigns }))} />
            </View>
            <View style={styles.col}>
              <AppText variant="title">Son 30 gün gösterim (ilçe)</AppText>
              <HorizontalBars data={data.impressions_by_district_30d.map((item) => ({ label: item.district, value: item.impressions }))} />
            </View>
            <View style={styles.col}>
              <AppText variant="title">Son 30 gün gösterim (şehir)</AppText>
              <HorizontalBars data={data.impressions_by_city_30d.map((item) => ({ label: item.city, value: item.impressions }))} />
            </View>
          </View>
        </>
      ) : (
        <AppText variant="body" color="textSecondary">
          Yükleniyor…
        </AppText>
      )}
    </AdminSection>
  );
}

export function DetailPagesSection({ onEdit }: { onEdit: (id: string) => void }) {
  const router = useRouter();
  const [offset, setOffset] = useState(0);
  const campaigns = useAdCampaigns(null, '', offset, 50);
  const rows = (campaigns.data?.items ?? []).filter((item) => item.status !== 'archived');
  const columns: Column<AdCampaignListItem>[] = [
    {
      key: 'name',
      label: 'Kampanya',
      width: 2,
      render: (row) => (
        <View style={styles.flex}>
          <AppText variant="caption" style={styles.bold} numberOfLines={1}>
            {row.name}
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {row.destination_type === 'detail_page' ? 'Banner detay sayfasına yönlendiriyor' : `Yönlendirme: ${row.destination_type ?? '—'}`}
          </AppText>
        </View>
      ),
    },
    {
      key: 'status',
      label: 'Durum',
      width: 0.9,
      render: (row) => <Badge label={CAMPAIGN_STATUS[row.status].label} tone={CAMPAIGN_STATUS[row.status].tone} />,
    },
    {
      key: 'actions',
      label: '',
      width: 1.2,
      render: (row) => (
        <View style={styles.actions}>
          <Button label="Önizle" size="sm" variant="ghost" fullWidth={false} onPress={() => router.push(`/ad/${row.id}` as never)} />
          {!['expired', 'archived'].includes(row.status) ? (
            <Button label="İçeriği düzenle" size="sm" variant="ghost" fullWidth={false} onPress={() => onEdit(row.id)} />
          ) : null}
        </View>
      ),
    },
  ];
  return (
    <AdminSection
      title="Reklam detay sayfaları"
      subtitle="Her doğrudan kampanyanın 'Sponsorlu' etiketli detay sayfası vardır. Boş alanlar kullanıcıya gösterilmez; yayında olmayan kampanyalar yalnızca yönetici önizlemesiyle açılır."
    >
      <DataTable columns={columns} rows={rows} keyExtractor={(row) => row.id} loading={campaigns.isLoading} empty={<AppText variant="body" color="textSecondary">Kampanya yok.</AppText>} />
      {campaigns.data ? <Pager total={campaigns.data.total} limit={campaigns.data.limit} offset={campaigns.data.offset} onChange={setOffset} /> : null}
    </AdminSection>
  );
}

export function AuditSection() {
  const [offset, setOffset] = useState(0);
  const audit = useAdsAudit(offset);
  const columns: Column<AdAuditItem>[] = [
    {
      key: 'when',
      label: 'Zaman',
      width: 1,
      render: (row) => (
        <AppText variant="caption" color="textTertiary">
          {formatDateShort(row.created_at)}
        </AppText>
      ),
    },
    {
      key: 'action',
      label: 'İşlem',
      width: 2.4,
      render: (row) => (
        <View style={styles.flex}>
          <AppText variant="caption" style={styles.bold} numberOfLines={1}>
            {row.label}
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {row.campaign_name ?? row.target_id ?? ''} · {row.action}
            {typeof row.meta?.reason === 'string' && row.meta.reason ? ` — ${row.meta.reason}` : ''}
          </AppText>
        </View>
      ),
    },
    {
      key: 'actor',
      label: 'Yapan',
      width: 0.9,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary">
          {row.actor ? (row.actor === 'sistem' ? 'Sistem' : `@${row.actor}`) : '—'}
        </AppText>
      ),
    },
  ];
  return (
    <AdminSection title="Denetim kayıtları" subtitle="Tüm reklam yönetimi işlemleri ve otomatik durum geçişleri değiştirilemez denetim kaydına yazılır.">
      <DataTable columns={columns} rows={audit.data?.items ?? []} keyExtractor={(row) => row.id} loading={audit.isLoading} empty={<AppText variant="body" color="textSecondary">Kayıt yok.</AppText>} />
      {audit.data ? <Pager total={audit.data.total} limit={40} offset={offset} onChange={setOffset} /> : null}
    </AdminSection>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '700' },
  twoCol: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  col: { flexGrow: 1, flexBasis: 300, gap: 8 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
