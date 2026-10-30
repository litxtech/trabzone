import { useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui';
import { AdminSection, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { BarChart, HorizontalBars, TrendChart } from '@/features/admin/components/Charts';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { AdminQueryState } from '@/features/explore/admin/AdminExploreShared';
import { formatDateTime } from '@/features/pharmacy/admin/shared';

import { formatDecimal, formatMagnitude } from '../utils/format';
import { useAdminEarthquakeAnalytics, useAdminEarthquakeAudit } from './api';

const MAG_LABELS: Record<string, string> = {
  below_0: '0 altı',
  m0: '0–1,9',
  m2: '2,0–2,9',
  m3: '3,0–3,9',
  m4: '4,0–4,9',
  m5: '5,0+',
};

export function AnalyticsTab() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const analytics = useAdminEarthquakeAnalytics(Number(days), true);
  const data = analytics.data;
  const short = (day: string) => day.slice(8, 10) + '.' + day.slice(5, 7);

  return (
    <View style={{ gap: 14 }}>
      <FilterChips
        options={[
          { key: '7', label: 'Son 7 gün' },
          { key: '30', label: 'Son 30 gün' },
          { key: '90', label: 'Son 90 gün' },
        ]}
        value={days}
        onChange={(value) => setDays(value as typeof days)}
      />
      <AdminQueryState loading={analytics.isLoading} error={analytics.isError ? analytics.error.message : null} onRetry={() => void analytics.refetch()}>
        {data ? (
          <>
            <StatGrid>
              <StatCard label="Toplam kayıt" value={String(data.daily.reduce((s, d) => s + d.total, 0))} icon="pulse-outline" />
              <StatCard label="150 km içinde" value={String(data.daily.reduce((s, d) => s + d.r150, 0))} icon="locate-outline" />
              <StatCard label="Trabzon ili" value={String(data.daily.reduce((s, d) => s + d.province, 0))} icon="map-outline" hint={`Açıklar: ${data.offshore}`} />
              <StatCard label="Detay görüntüleme" value={String(data.daily.reduce((s, d) => s + d.views, 0))} icon="eye-outline" />
              <StatCard
                label="Kaynak karşılaştırma"
                value={`${data.source_comparison.both} ortak`}
                icon="git-compare-outline"
                hint={`Yalnız AFAD ${data.source_comparison.afad_only} · yalnız USGS ${data.source_comparison.usgs_only} · ort. ΔM ${formatDecimal(
                  data.source_comparison.avg_magnitude_delta,
                  2,
                )} · ort. mesafe ${formatDecimal(data.source_comparison.avg_distance_km, 1)} km`}
              />
              <StatCard
                label="Push (gönderilen / başarısız)"
                value={`${data.daily.reduce((s, d) => s + d.push_sent, 0)} / ${data.daily.reduce((s, d) => s + d.push_failed, 0)}`}
                icon="notifications-outline"
              />
            </StatGrid>
            <AdminSection title="Günlük kayıt sayısı (tüm bölge)">
              <TrendChart data={data.daily.map((d) => ({ label: short(d.day), value: d.total }))} />
            </AdminSection>
            <AdminSection title="Günlük kayıt (150 km)">
              <BarChart data={data.daily.map((d) => ({ label: short(d.day), value: d.r150 }))} />
            </AdminSection>
            <AdminSection title="Kaynaktan ulaşma süresi (ortalama, sn)" subtitle="Depremin oluş anından Trabzone’a ulaşmasına kadar geçen süre (yalnız canlı kayıtlar).">
              <TrendChart data={data.daily.map((d) => ({ label: short(d.day), value: d.avg_ingest_seconds ?? 0 }))} formatValue={(v) => `${Math.round(v)} sn`} />
            </AdminSection>
            <AdminSection title="Büyüklük dağılımı">
              <HorizontalBars data={Object.entries(data.magnitude_bins).map(([key, value]) => ({ label: MAG_LABELS[key] ?? key, value }))} />
            </AdminSection>
            <AdminSection title="İlçelere göre (merkez üssü ilçe sınırı içinde)">
              <HorizontalBars data={data.districts.filter((d) => d.count > 0).map((d) => ({ label: d.name, value: d.count }))} />
              {data.districts.every((d) => d.count === 0) ? (
                <AppText variant="caption" color="textSecondary">
                  Bu aralıkta ilçe sınırı içinde kayıt yok.
                </AppText>
              ) : null}
            </AdminSection>
            <AdminSection title="En çok görüntülenenler">
              {data.top_viewed.length === 0 ? (
                <AppText variant="caption" color="textSecondary">
                  Henüz görüntüleme yok.
                </AppText>
              ) : (
                data.top_viewed.map((item) => (
                  <AppText key={item.canonical_id} variant="caption" color="textSecondary">
                    {item.views} · {formatMagnitude(item.magnitude, item.magnitude_type)} · {item.location ?? '—'} · {formatDateTime(item.occurred_at)} ·{' '}
                    {item.canonical_id}
                  </AppText>
                ))
              )}
            </AdminSection>
          </>
        ) : null}
      </AdminQueryState>
    </View>
  );
}

export function AuditTab() {
  const [offset, setOffset] = useState(0);
  const audit = useAdminEarthquakeAudit(offset, true);
  const items = audit.data ?? [];
  return (
    <AdminSection title="Denetim kaydı" subtitle="Deprem merkezindeki tüm yönetim işlemleri; gerekçe, eski ve yeni değerlerle.">
      <AdminQueryState loading={audit.isLoading} error={audit.isError ? audit.error.message : null} onRetry={() => void audit.refetch()}>
        {items.length === 0 ? (
          <AppText variant="caption" color="textSecondary">
            Kayıt yok.
          </AppText>
        ) : (
          items.map((entry) => (
            <View key={entry.id} style={{ gap: 2, paddingVertical: 4 }}>
              <AppText variant="label">
                {formatDateTime(entry.created_at)} · {entry.operation} · {entry.admin_username ?? entry.admin_id ?? 'sistem'}
              </AppText>
              <AppText variant="caption" color="textSecondary">
                Hedef: {entry.target_type} {entry.target_id ?? ''} · Gerekçe: {entry.reason ?? '—'}
              </AppText>
              {entry.old_value != null || entry.new_value != null ? (
                <AppText variant="caption" color="textTertiary" selectable>
                  Eski: {JSON.stringify(entry.old_value)} → Yeni: {JSON.stringify(entry.new_value)}
                </AppText>
              ) : null}
            </View>
          ))
        )}
        <Pager total={offset + items.length + (items.length === 30 ? 1 : 0)} limit={30} offset={offset} onChange={setOffset} />
      </AdminQueryState>
    </AdminSection>
  );
}
