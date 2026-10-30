import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Button, IconButton } from '@/components/ui';
import { EqPage } from '@/features/earthquake/components/EqPage';
import { FilterSheet, filterSummary } from '@/features/earthquake/components/FilterSheet';
import { ChipRow, EarthquakeRow, EmptyState, InfoNote } from '@/features/earthquake/components/parts';
import {
  earthquakeKeys,
  useEarthquakeBootstrap,
  useEarthquakeFilters,
  useTimeBucket,
} from '@/features/earthquake/hooks/use-earthquake';
import * as api from '@/features/earthquake/services/earthquake-service';
import { useEarthquakeFilterStore } from '@/features/earthquake/store';
import type { EarthquakeFeedPage, EarthquakeFilters, EarthquakeOrder } from '@/features/earthquake/types';
import { formatLocalDate } from '@/features/earthquake/utils/format';
import { MAGNITUDE_BUCKETS } from '@/features/earthquake/utils/scale';
import { useWebMeta } from '@/features/web/use-web-meta';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

const PAGE_SIZE = 50;

type ArchiveRange = '30d' | '90d' | '365d' | 'all';

const RANGES: { key: ArchiveRange; label: string; days: number | null }[] = [
  { key: '30d', label: 'Son 30 gün', days: 30 },
  { key: '90d', label: 'Son 90 gün', days: 90 },
  { key: '365d', label: 'Son 1 yıl', days: 365 },
  { key: 'all', label: 'Tüm arşiv', days: null },
];

const ORDERS: { key: EarthquakeOrder; label: string }[] = [
  { key: 'newest', label: 'En yeni' },
  { key: 'oldest', label: 'En eski' },
  { key: 'largest', label: 'En büyük' },
  { key: 'nearest', label: 'En yakın' },
];

export default function EarthquakeArchiveScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [range, setRange] = useState<ArchiveRange>('90d');
  const [order, setOrder] = useState<EarthquakeOrder>('newest');
  const [offset, setOffset] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);

  useWebMeta({
    title: 'Trabzon Deprem Arşivi | Trabzone Deprem Merkezi',
    description: 'Trabzon ve çevresinde kaydedilen geçmiş depremlerin tarih, büyüklük, derinlik ve kaynak bilgileri.',
    path: '/deprem/arsiv',
  });

  const bootstrap = useEarthquakeBootstrap();
  const shared = useEarthquakeFilters();
  const store = useEarthquakeFilterStore();
  const archiveSince = bootstrap.data?.coverage.archive_since ?? null;
  const dayTick = useTimeBucket(3_600_000);

  const filters = useMemo<EarthquakeFilters>(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    const from = days ? new Date(dayTick * 3_600_000 - days * 86_400_000).toISOString() : archiveSince;
    return {
      region: shared.region,
      district: shared.district,
      from,
      to: null,
      minMagnitude: shared.minMagnitude,
      maxMagnitude: shared.maxMagnitude,
      source: shared.source,
    };
  }, [range, dayTick, archiveSince, shared.region, shared.district, shared.minMagnitude, shared.maxMagnitude, shared.source]);

  const page = useQuery<EarthquakeFeedPage>({
    queryKey: [...earthquakeKeys.feed(filters, order), 'page', offset],
    queryFn: async () => {
      const result = await api.fetchFeed(filters, order, PAGE_SIZE, offset);
      if (!result.ok) throw result.error;
      return result.data;
    },
    enabled: bootstrap.isSuccess && (range !== 'all' || archiveSince != null),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const reset = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setOffset(0);
  };

  const total = page.data?.total ?? 0;
  const items = page.data?.items ?? [];
  const districtName = shared.district ? bootstrap.data?.districts.find((d) => d.key === shared.district)?.name ?? null : null;

  return (
    <EqPage
      title="Deprem Arşivi"
      subtitle="Geçmiş deprem kayıtları"
      right={<IconButton name="options-outline" accessibilityLabel="Filtreler" variant="soft" onPress={() => setFilterOpen(true)} />}
    >
      <InfoNote>
        {archiveSince
          ? `Arşiv, Trabzone’un kaynaklardan aldığı kayıtları içerir: ${formatLocalDate(archiveSince)} tarihinden itibaren. Daha eski dönemler için AFAD ve USGS kataloglarına bakın.`
          : 'Arşiv kapsamı henüz belirlenemedi.'}
      </InfoNote>
      <AppText variant="caption" color="textSecondary">
        {filterSummary(shared.regionResolved, districtName, 'custom', store.bucket).replace(' · Özel aralık', '')}
      </AppText>
      <ChipRow label="Zaman aralığı" options={RANGES.map(({ key, label }) => ({ key, label }))} value={range} onChange={reset(setRange)} />
      <ChipRow
        label="Büyüklük"
        options={MAGNITUDE_BUCKETS.map((b) => ({ key: b.key, label: b.label }))}
        value={store.bucket}
        onChange={reset(store.setBucket)}
      />
      <ChipRow label="Sıralama" options={ORDERS} value={order} onChange={reset(setOrder)} />

      {page.isLoading ? (
        <ActivityIndicator style={styles.loader} color={theme.colors.primary} />
      ) : page.isError && !page.data ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Arşiv alınamadı"
          body="Kayıtlar yüklenemedi; bu bir veri yokluğu değildir."
          action={<Button label="Tekrar dene" variant="outline" size="sm" onPress={() => void page.refetch()} />}
        />
      ) : items.length === 0 ? (
        <EmptyState icon="archive-outline" title="Kayıt yok" body="Seçili filtrelerle arşivde deprem kaydı bulunmuyor." />
      ) : (
        <View style={styles.list}>
          <AppText variant="caption" color="textSecondary">
            {total} kayıttan {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} arası
          </AppText>
          {items.map((event) => (
            <EarthquakeRow key={event.id} event={event} onPress={() => router.push(`/deprem/${event.id}` as never)} />
          ))}
          <View style={styles.pager}>
            <Button
              label="Önceki"
              variant="outline"
              size="sm"
              disabled={offset === 0 || page.isFetching}
              onPress={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            />
            <AppText variant="caption" color="textSecondary">
              Sayfa {Math.floor(offset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </AppText>
            <Button
              label="Sonraki"
              variant="outline"
              size="sm"
              disabled={!page.data?.has_more || page.isFetching}
              onPress={() => setOffset(offset + PAGE_SIZE)}
            />
          </View>
        </View>
      )}

      <FilterSheet
        visible={filterOpen}
        onClose={() => {
          setFilterOpen(false);
          setOffset(0);
        }}
        bootstrap={bootstrap.data}
        region={shared.regionResolved}
        showRange={false}
      />
    </EqPage>
  );
}

const styles = StyleSheet.create({
  loader: { paddingVertical: 32 },
  list: { gap: 8 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
});
