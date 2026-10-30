import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Button, IconButton } from '@/components/ui';
import { BinChart, HeatGrid, ScatterChart, TimeSeriesChart } from '@/features/earthquake/components/Charts';
import { EqPage } from '@/features/earthquake/components/EqPage';
import { FilterSheet, filterSummary } from '@/features/earthquake/components/FilterSheet';
import { ChipRow, EmptyState, InfoNote, SectionTitle } from '@/features/earthquake/components/parts';
import {
  useEarthquakeAnalytics,
  useEarthquakeBootstrap,
  useEarthquakeFilters,
  useEarthquakeRealtime,
} from '@/features/earthquake/hooks/use-earthquake';
import { useEarthquakeFilterStore } from '@/features/earthquake/store';
import { formatDecimal, formatDepth, formatLocalDate, formatLocalDateTime, formatMagnitude } from '@/features/earthquake/utils/format';
import { magnitudeColor, RANGE_PRESETS } from '@/features/earthquake/utils/scale';
import { useWebMeta } from '@/features/web/use-web-meta';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

const DEPTH_COLORS = ['#F2C14E', '#E79A3C', '#C8663A', '#8E4A3B', '#4F3A4F'];

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.lg }]}>
      <AppText variant="bodyStrong" accessibilityRole="header">
        {title}
      </AppText>
      {note ? (
        <AppText variant="caption" color="textTertiary">
          {note}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}

export default function EarthquakeAnalyticsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [filterOpen, setFilterOpen] = useState(false);

  useWebMeta({
    title: 'Trabzon Deprem İstatistikleri | Trabzone Deprem Merkezi',
    description: 'Trabzon ve çevresindeki depremlerin zaman, büyüklük ve derinlik dağılımı, saçılım grafikleri ve yoğunluk ızgarası.',
    path: '/deprem/analiz',
  });

  useEarthquakeRealtime();
  const bootstrap = useEarthquakeBootstrap();
  const filters = useEarthquakeFilters();
  const store = useEarthquakeFilterStore();
  const analytics = useEarthquakeAnalytics(filters, bootstrap.isSuccess);
  const data = analytics.data;
  const open = (id: string) => router.push(`/deprem/${id}` as never);
  const districtName = filters.district ? bootstrap.data?.districts.find((d) => d.key === filters.district)?.name ?? null : null;

  const scatterTime = useMemo(() => {
    if (!data || data.points.length === 0) return null;
    const xs = data.points.map((p) => Date.parse(p.occurredAt));
    const ms = data.points.map((p) => p.magnitude);
    return {
      data: data.points.map((p) => ({
        id: p.id,
        x: Date.parse(p.occurredAt),
        y: p.magnitude,
        magnitude: p.magnitude,
        label: `${formatMagnitude(p.magnitude, p.magnitudeType)} · ${formatLocalDateTime(p.occurredAt)} · Derinlik ${formatDepth(p.depthKm)}`,
      })),
      xDomain: [Math.min(...xs), Math.max(...xs)] as [number, number],
      yDomain: [Math.min(0, Math.floor(Math.min(...ms))), Math.max(3, Math.ceil(Math.max(...ms)))] as [number, number],
    };
  }, [data]);

  const scatterDepth = useMemo(() => {
    if (!data) return null;
    const known = data.points.filter((p) => p.depthKm != null);
    if (known.length === 0) return null;
    const ms = known.map((p) => p.magnitude);
    const ds = known.map((p) => p.depthKm as number);
    return {
      data: known.map((p) => ({
        id: p.id,
        x: p.magnitude,
        y: p.depthKm as number,
        magnitude: p.magnitude,
        label: `${formatMagnitude(p.magnitude, p.magnitudeType)} · Derinlik ${formatDepth(p.depthKm)} · ${formatLocalDate(p.occurredAt)}`,
      })),
      xDomain: [Math.min(0, Math.floor(Math.min(...ms))), Math.max(3, Math.ceil(Math.max(...ms)))] as [number, number],
      yDomain: [0, Math.max(10, Math.ceil(Math.max(...ds) / 10) * 10)] as [number, number],
    };
  }, [data]);

  return (
    <EqPage
      title="Deprem İstatistikleri"
      subtitle="Seçili bölge ve aralık için grafikler"
      right={<IconButton name="options-outline" accessibilityLabel="Filtreler" variant="soft" onPress={() => setFilterOpen(true)} />}
    >
      <ChipRow
        label="Zaman aralığı"
        options={RANGE_PRESETS.map((p) => ({ key: p.key, label: p.label }))}
        value={store.range === 'custom' ? '7d' : store.range}
        onChange={(key) => store.setRange(key)}
      />
      <AppText variant="caption" color="textSecondary">
        {filterSummary(filters.regionResolved, districtName, store.range, store.bucket)}
        {data ? ` · ${data.total} kayıt` : ''}
      </AppText>

      {analytics.isLoading || (!data && !analytics.isError) ? (
        <ActivityIndicator style={styles.loader} color={theme.colors.primary} />
      ) : analytics.isError && !data ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="İstatistikler alınamadı"
          body="Veri alınamadığında grafik veya sayı üretilmez."
          action={<Button label="Tekrar dene" variant="outline" size="sm" onPress={() => void analytics.refetch()} />}
        />
      ) : !data || data.total === 0 ? (
        <EmptyState icon="stats-chart-outline" title="Grafik için kayıt yok" body="Seçili filtrelerle deprem kaydı bulunmuyor." />
      ) : (
        <>
          <Panel
            title="Zamana göre deprem sayısı"
            note={`Her çubuk bir ${data.bucket === 'hour' ? 'saat' : data.bucket === 'day' ? 'gün' : 'hafta'} (Türkiye saati). Renk o dilimdeki en büyük depremi gösterir.`}
          >
            <TimeSeriesChart series={data.series} bucket={data.bucket} />
          </Panel>

          <Panel title="Büyüklük dağılımı">
            <BinChart bins={data.magnitude_bins} colorFor={(bin) => magnitudeColor(Number(bin.key.replace('m', '')) || 0)} />
          </Panel>

          <Panel
            title="Derinlik dağılımı"
            note={data.unknown_depth > 0 ? `${data.unknown_depth} kayıtta derinlik bildirilmemiş; bu kayıtlar dağılıma dahil değildir.` : undefined}
          >
            <BinChart bins={data.depth_bins} colorFor={(_, index) => DEPTH_COLORS[index % DEPTH_COLORS.length] ?? theme.colors.primary} />
          </Panel>

          {scatterTime ? (
            <Panel
              title="Büyüklük – zaman"
              note={data.points_truncated ? `Okunabilirlik için en yeni ${data.points.length} kayıt çizildi.` : undefined}
            >
              <ScatterChart
                data={scatterTime.data}
                xDomain={scatterTime.xDomain}
                yDomain={scatterTime.yDomain}
                xLabel="Zaman"
                yLabel="Büyüklük"
                formatX={(value) => formatLocalDate(new Date(value)).slice(0, 5)}
                formatY={(value) => formatDecimal(value, 1)}
                onOpen={open}
              />
            </Panel>
          ) : null}

          {scatterDepth ? (
            <Panel title="Derinlik – büyüklük" note="Yüzey üstte; aşağı indikçe odak derinleşir.">
              <ScatterChart
                data={scatterDepth.data}
                xDomain={scatterDepth.xDomain}
                yDomain={scatterDepth.yDomain}
                xLabel="Büyüklük"
                yLabel="Derinlik (km)"
                formatX={(value) => formatDecimal(value, 1)}
                formatY={(value) => `${Math.round(value)} km`}
                yInverted
                onOpen={open}
              />
            </Panel>
          ) : null}

          {data.grid.length > 0 ? (
            <Panel
              title="Bölgesel yoğunluk"
              note={`Her hücre yaklaşık ${formatDecimal(data.grid_cell_deg, 2)}° × ${formatDecimal(data.grid_cell_deg, 2)}°; koyu hücrelerde daha çok merkez üssü var.`}
            >
              <HeatGrid grid={data.grid} cellDeg={data.grid_cell_deg} center={bootstrap.data?.settings.center ?? { lat: 41.0027, lng: 39.7168 }} />
            </Panel>
          ) : null}

          <SectionTitle title="Notlar" />
          <InfoNote>
            Grafikler yalnızca kaynaklardan alınmış gerçek kayıtlardan üretilir. Aynı depremin AFAD ve USGS kayıtları tek
            deprem olarak sayılır. Büyüklük türleri (ML, Mw, mb…) farklı yöntemlerdir; doğrudan karşılaştırırken dikkatli
            olun.
          </InfoNote>
        </>
      )}

      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        bootstrap={bootstrap.data}
        region={filters.regionResolved}
      />
    </EqPage>
  );
}

const styles = StyleSheet.create({
  loader: { paddingVertical: 32 },
  panel: { padding: 14, gap: 8, borderWidth: StyleSheet.hairlineWidth },
});
